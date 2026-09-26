package com.razatech.diffsense.ide

import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory

class DiffSenseToolWindowFactory : ToolWindowFactory, DumbAware {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val panel = SummaryPanel(project)
        val session = DiffSenseSession.getInstance(project)
        session.panel = panel
        toolWindow.contentManager.addContent(ContentFactory.getInstance().createContent(panel, "", false))
        session.last?.let { panel.update(it) }
    }
}
