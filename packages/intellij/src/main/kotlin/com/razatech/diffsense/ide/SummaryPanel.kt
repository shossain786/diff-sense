package com.razatech.diffsense.ide

import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.fileChooser.FileSaverDescriptor
import com.intellij.openapi.fileChooser.FileChooserFactory
import com.intellij.openapi.project.Project
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBCheckBox
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.table.JBTable
import com.intellij.util.ui.JBUI
import com.razatech.diffsense.engine.Change
import com.razatech.diffsense.engine.ChangeKind
import com.razatech.diffsense.engine.Format
import com.razatech.diffsense.engine.apiMismatches
import com.razatech.diffsense.engine.formatValue
import com.razatech.diffsense.engine.renderMarkdown
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Component
import java.awt.FlowLayout
import java.awt.datatransfer.StringSelection
import java.awt.event.MouseEvent
import javax.swing.BoxLayout
import javax.swing.JButton
import javax.swing.JPanel
import javax.swing.JTable
import javax.swing.table.AbstractTableModel
import javax.swing.table.DefaultTableCellRenderer

private val GREEN = JBColor(Color(0x2E7D32), Color(0x81B88B))
private val RED = JBColor(Color(0xC62828), Color(0xE5736A))
private val AMBER = JBColor(Color(0x9A6700), Color(0xCCA700))

private fun kindColor(c: Change): Color? = when (c.kind) {
    ChangeKind.ADDED -> GREEN
    ChangeKind.REMOVED -> RED
    ChangeKind.MODIFIED -> AMBER
    ChangeKind.UNCHANGED -> null
}

/** Rows of the summary table: structural results show what changed, API results show every check. */
private class ChangesModel : AbstractTableModel() {
    var rows: List<Change> = emptyList()
    var api = false

    private val names get() = if (api) arrayOf("", "Field", "Expected", "Actual") else arrayOf("", "Path", "Before", "After", "Impact")

    override fun getRowCount() = rows.size
    override fun getColumnCount() = names.size
    override fun getColumnName(column: Int) = names[column]

    fun change(row: Int) = rows[row]

    override fun getValueAt(row: Int, col: Int): Any {
        val c = rows[row]
        return when (col) {
            0 -> symbol(c)
            1 -> if (api && c.path.startsWith("body.")) c.path.substring(5) else c.path
            2 -> if (c.kind == ChangeKind.ADDED) (if (api) "(not expected)" else "") else formatValue(c.before)
            3 -> if (c.kind == ChangeKind.REMOVED) (if (api) "(missing)" else "") else formatValue(c.after)
            else -> if (c.impact != null && c.impact.id != "informational") c.impact.id.uppercase() else ""
        }
    }

    private fun symbol(c: Change) = when {
        api -> if (c.kind == ChangeKind.UNCHANGED) "✓" else "✗"
        c.kind == ChangeKind.ADDED -> "+"
        c.kind == ChangeKind.REMOVED -> "−"
        c.kind == ChangeKind.MODIFIED -> "⚠"
        else -> "✓"
    }
}

/** The DiffSense tool window: verdict, stats, the change table and export actions. */
class SummaryPanel(private val project: Project) : JPanel(BorderLayout()) {
    private val title = JBLabel("DiffSense").apply { font = font.deriveFont(font.size2D + 3f).deriveFont(java.awt.Font.BOLD) }
    private val subtitle = JBLabel()
    private val stats = JBLabel()
    private val notes = JBLabel()
    private val changesModel = ChangesModel()
    private val showUnchanged = JBCheckBox("Show unchanged")
    private var current: Analysis? = null

    private val table = object : JBTable(changesModel) {
        override fun getToolTipText(event: MouseEvent): String? {
            val row = rowAtPoint(event.point)
            if (row < 0) return null
            val c = changesModel.change(convertRowIndexToModel(row))
            return c.reason ?: super.getToolTipText(event)
        }
    }

    private val openDiff = JButton("Open Diff")
    private val swap = JButton("Swap sides").apply { toolTipText = "Treat the right file as the old version and the left as the new one" }
    private val copy = JButton("Copy as Markdown")
    private val export = JButton("Export Markdown…")

    init {
        border = JBUI.Borders.empty(8, 12)
        val header = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            isOpaque = false
            for (l in listOf(title, subtitle, stats)) {
                l.alignmentX = Component.LEFT_ALIGNMENT
                add(l)
            }
            add(JPanel(FlowLayout(FlowLayout.LEFT, 0, JBUI.scale(6))).apply {
                isOpaque = false
                alignmentX = Component.LEFT_ALIGNMENT
                for (b in listOf(openDiff, swap, copy, export)) add(b)
                add(showUnchanged)
            })
        }
        add(header, BorderLayout.NORTH)

        table.apply {
            setShowGrid(false)
            rowHeight = JBUI.scale(24)
            tableHeader.reorderingAllowed = false
            autoResizeMode = JTable.AUTO_RESIZE_LAST_COLUMN
            setDefaultRenderer(Any::class.java, object : DefaultTableCellRenderer() {
                override fun getTableCellRendererComponent(t: JTable, v: Any?, sel: Boolean, focus: Boolean, row: Int, col: Int): Component {
                    val comp = super.getTableCellRendererComponent(t, v, sel, false, row, col)
                    val c = changesModel.change(t.convertRowIndexToModel(row))
                    if (!sel) foreground = if (col == 0 || col == 1) kindColor(c) ?: t.foreground else t.foreground
                    toolTipText = null
                    return comp
                }
            })
        }
        add(JBScrollPane(table), BorderLayout.CENTER)
        add(notes, BorderLayout.SOUTH)

        openDiff.addActionListener { current?.let { DiffSenseRunner.openNativeDiff(project, it) } }
        swap.addActionListener { current?.let { DiffSenseRunner.swap(project, it) } }
        copy.addActionListener {
            current?.let {
                CopyPasteManager.getInstance().setContents(StringSelection(renderMarkdown(it.result)))
                DiffSenseRunner.notify(project, "Summary copied as Markdown")
            }
        }
        export.addActionListener { current?.let { exportMarkdown(it) } }
        showUnchanged.addActionListener { current?.let { rebuild(it) } }
        showEmpty()
    }

    private fun showEmpty() {
        subtitle.text = "Select two files, right-click and choose \"Compare with DiffSense\"."
        stats.text = ""
        notes.text = ""
        listOf(openDiff, swap, copy, export, showUnchanged).forEach { it.isEnabled = false }
    }

    fun update(a: Analysis) {
        current = a
        listOf(openDiff, swap, copy, export, showUnchanged).forEach { it.isEnabled = true }
        val r = a.result
        val api = r.format == Format.API
        showUnchanged.isVisible = !api
        title.text = if (api) "API Response Comparison" else "DiffSense"
        if (api) {
            val bad = apiMismatches(r)
            subtitle.text = "Expected: ${a.left.name} · Actual: ${a.right.name}"
            stats.text = (if (bad == 0) "PASS — actual matches expected" else "FAIL — $bad mismatch${if (bad == 1) "" else "es"}") +
                "   (${r.stats.unchanged} matched)"
        } else {
            val (added, removed, modified, unchanged) = r.stats
            subtitle.text = "Before: ${a.left.name} · After: ${a.right.name} · ${r.format.id}"
            stats.text = "${added + removed + modified} changes: $modified modified, $added added, $removed removed · $unchanged unchanged" +
                (r.impact?.let { " · potential impact (estimate): ${it.id}" } ?: "")
        }
        notes.text = r.warnings.joinToString("  ")
        rebuild(a)
    }

    private fun rebuild(a: Analysis) {
        val api = a.result.format == Format.API
        changesModel.api = api
        changesModel.rows = if (api || showUnchanged.isSelected) a.result.changes else a.result.changes.filter { it.kind != ChangeKind.UNCHANGED }
        changesModel.fireTableStructureChanged()
        table.columnModel.getColumn(0).apply { minWidth = JBUI.scale(28); maxWidth = JBUI.scale(28) }
        table.columnModel.getColumn(1).preferredWidth = JBUI.scale(260)
        if (!api && changesModel.columnCount > 4) table.columnModel.getColumn(4).apply { minWidth = JBUI.scale(80); maxWidth = JBUI.scale(90) }
    }

    private fun exportMarkdown(a: Analysis) {
        val dialog = FileChooserFactory.getInstance().createSaveFileDialog(
            FileSaverDescriptor("Export DiffSense Summary", "Save the summary as a Markdown file", "md"), project,
        )
        val target = dialog.save(null as com.intellij.openapi.vfs.VirtualFile?, "diffsense-summary.md") ?: return
        try {
            target.file.writeText(renderMarkdown(a.result))
            DiffSenseRunner.notify(project, "Saved ${target.file.name}")
        } catch (e: java.io.IOException) {
            DiffSenseRunner.notify(project, "Could not save the file: ${e.message}", NotificationType.ERROR)
        }
    }
}
