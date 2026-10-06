package com.razatech.diffsense.ide

import com.intellij.diff.DiffContentFactory
import com.intellij.diff.DiffManager
import com.intellij.diff.requests.SimpleDiffRequest
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.readAction
import com.intellij.openapi.progress.runBlockingCancellable
import com.intellij.openapi.fileTypes.FileTypeManager
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.guessProjectDir
import com.intellij.openapi.vfs.VfsUtil
import com.razatech.diffsense.engine.CompareOptions
import com.razatech.diffsense.engine.ComparisonResult
import com.razatech.diffsense.engine.DiffSenseConfig
import com.razatech.diffsense.engine.FileInput
import com.razatech.diffsense.engine.compare
import com.razatech.diffsense.engine.detectFormat
import com.razatech.diffsense.engine.parseConfig
import com.razatech.diffsense.engine.resolveOptions

/** What the tool window needs to redo or swap a comparison. */
class Analysis(val result: ComparisonResult, val left: Side, val right: Side, val forced: CompareOptions)

object DiffSenseRunner {
    /**
     * Compares in the background, then opens the IDE's native diff and fills the DiffSense tool window.
     * Files are read under a read action so unsaved editor text is what gets compared.
     */
    fun run(project: Project, readSides: () -> Pair<Side, Side>, forced: CompareOptions = CompareOptions(), openDiff: Boolean = true) {
        ProgressManager.getInstance().run(object : Task.Backgroundable(project, "DiffSense: analyzing…", false) {
            private var analysis: Analysis? = null
            private var error: String? = null

            override fun run(indicator: ProgressIndicator) {
                try {
                    val (left, right) = runBlockingCancellable { readAction { readSides() } }
                    val config = loadConfig(project)
                    val format = forced.format ?: detectFormat(left.name)
                    val options = DiffSenseSettings.getInstance().toOptions()
                        .overlay(resolveOptions(config, format))
                        .overlay(forced)
                    val result = compare(FileInput(left.name, left.text), FileInput(right.name, right.text), options)
                    analysis = Analysis(result, left, right, forced)
                } catch (e: IllegalArgumentException) {
                    error = e.message
                } catch (e: Exception) {
                    error = "Could not read the files as text (${e.message})"
                }
            }

            override fun onSuccess() {
                val a = analysis
                if (a == null) {
                    notify(project, error ?: "Comparison failed", NotificationType.ERROR)
                    return
                }
                DiffSenseSession.getInstance(project).show(a)
                if (openDiff) openNativeDiff(project, a)
            }
        })
    }

    fun openNativeDiff(project: Project, a: Analysis) {
        val f = DiffContentFactory.getInstance()
        fun content(s: Side) = s.file?.let { f.create(project, it) }
            ?: f.create(project, s.text, FileTypeManager.getInstance().getFileTypeByFileName(s.name))
        val request = SimpleDiffRequest("${a.left.name} ↔ ${a.right.name}", content(a.left), content(a.right), a.left.name, a.right.name)
        DiffManager.getInstance().showDiff(project, request)
    }

    /** Re-runs the same comparison with the sides swapped (the left file is treated as the "before"). */
    fun swap(project: Project, a: Analysis) = run(project, { a.right to a.left }, a.forced)

    private fun loadConfig(project: Project): DiffSenseConfig {
        val root = project.guessProjectDir() ?: return DiffSenseConfig()
        val file = root.findChild(".diffsense.json")?.takeIf { !it.isDirectory } ?: return DiffSenseConfig()
        val parsed = parseConfig(VfsUtil.loadText(file))
        if (parsed.errors.isNotEmpty()) {
            ApplicationManager.getApplication().invokeLater {
                notify(project, "Problems in .diffsense.json: ${parsed.errors.first()}", NotificationType.WARNING)
            }
        }
        return parsed.value
    }

    fun notify(project: Project?, message: String, type: NotificationType = NotificationType.INFORMATION) {
        NotificationGroupManager.getInstance().getNotificationGroup("DiffSense")
            .createNotification("DiffSense", message, type)
            .notify(project)
    }
}
