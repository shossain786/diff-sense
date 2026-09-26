package com.razatech.diffsense.ide

import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.fileChooser.FileChooser
import com.intellij.openapi.fileChooser.FileChooserDescriptorFactory
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.vfs.VirtualFile
import com.razatech.diffsense.engine.CompareOptions
import com.razatech.diffsense.engine.Format
import java.awt.datatransfer.DataFlavor

private fun selectedFiles(e: AnActionEvent): List<VirtualFile> =
    e.getData(CommonDataKeys.VIRTUAL_FILE_ARRAY)?.filter { !it.isDirectory }.orEmpty()

private fun maxBytes() = DiffSenseSettings.getInstance().state.maxFileSizeMb.toLong() * 1_048_576

/** One or two files selected (Project view, editor tab, or the file open in the editor). */
abstract class CompareFilesActionBase(private val forced: CompareOptions) : DumbAwareAction() {
    override fun getActionUpdateThread() = ActionUpdateThread.BGT

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible = e.project != null && selectedFiles(e).size in 1..2
    }

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        var files = selectedFiles(e)
        if (files.size == 1) {
            val descriptor = FileChooserDescriptorFactory.singleFile().withTitle("Compare ${files[0].name} with…")
            val second = FileChooser.chooseFile(descriptor, project, files[0].parent) ?: return
            files = listOf(files[0], second)
        }
        if (files.size != 2) return
        val (a, b) = files
        val limit = maxBytes()
        DiffSenseRunner.run(project, { Side.of(a, limit) to Side.of(b, limit) }, forced)
    }
}

class CompareFilesAction : CompareFilesActionBase(CompareOptions())

/** Expected (first file) vs actual (second file), reported as pass/fail. */
class CompareApiResponsesAction : CompareFilesActionBase(CompareOptions(format = Format.API))

/** The current file (or its selection) against the clipboard. */
class CompareClipboardAction : DumbAwareAction() {
    override fun getActionUpdateThread() = ActionUpdateThread.EDT

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible = e.project != null && e.getData(CommonDataKeys.EDITOR) != null
    }

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val editor = e.getData(CommonDataKeys.EDITOR) ?: return
        val file = e.getData(CommonDataKeys.VIRTUAL_FILE)
        val name = file?.name ?: "clipboard.txt"
        val selection = editor.selectionModel.selectedText
        val left = if (selection != null) Side("$name (selection)", selection) else Side(name, editor.document.text, file)
        val clip = CopyPasteManager.getInstance().getContents<String>(DataFlavor.stringFlavor)
        if (clip == null) {
            DiffSenseRunner.notify(project, "The clipboard has no text to compare.")
            return
        }
        DiffSenseRunner.run(project, { left to Side(name, clip) })
    }
}

/** Two steps: select text and run once to remember it, then select other text and run again. */
class CompareSelectedTextAction : DumbAwareAction() {
    override fun getActionUpdateThread() = ActionUpdateThread.EDT

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible = e.project != null && e.getData(CommonDataKeys.EDITOR)?.selectionModel?.hasSelection() == true
    }

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val editor = e.getData(CommonDataKeys.EDITOR) ?: return
        val text = editor.selectionModel.selectedText ?: return
        val name = e.getData(CommonDataKeys.VIRTUAL_FILE)?.name ?: "selection.txt"
        val session = DiffSenseSession.getInstance(project)
        val first = session.pendingSelection
        if (first == null) {
            session.pendingSelection = Side(name, text)
            DiffSenseRunner.notify(project, "First selection saved. Select the second text and run \"Compare Selected Text\" again.")
            return
        }
        session.pendingSelection = null
        DiffSenseRunner.run(project, { first to Side(name, text) })
    }
}
