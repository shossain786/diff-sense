package com.razatech.diffsense.ide

import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindowManager

/** Holds the summary panel of a project's DiffSense tool window and the latest analysis. */
@Service(Service.Level.PROJECT)
class DiffSenseSession(private val project: Project) {
    var panel: SummaryPanel? = null
    var last: Analysis? = null
        private set

    /** Selection captured by "Compare Selected Text", waiting for the second selection. */
    var pendingSelection: Side? = null

    fun show(analysis: Analysis) {
        last = analysis
        val tw = ToolWindowManager.getInstance(project).getToolWindow(TOOL_WINDOW_ID) ?: return
        tw.show { panel?.update(analysis) }
    }

    companion object {
        const val TOOL_WINDOW_ID = "DiffSense"
        fun getInstance(project: Project): DiffSenseSession = project.service()
    }
}
