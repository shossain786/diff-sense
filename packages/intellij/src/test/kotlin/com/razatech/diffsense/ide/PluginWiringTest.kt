package com.razatech.diffsense.ide

import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.impl.SimpleDataContext
import com.intellij.testFramework.TestActionEvent
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.razatech.diffsense.engine.ChangeKind
import com.razatech.diffsense.engine.CompareOptions
import com.razatech.diffsense.engine.Format

/** Headless checks that plugin.xml is wired to real classes and the runner works end to end. */
class PluginWiringTest : BasePlatformTestCase() {
    fun testActionsAreRegistered() {
        val am = ActionManager.getInstance()
        for (id in listOf("DiffSense.CompareFiles", "DiffSense.CompareFilesMenu", "DiffSense.CompareApiResponses", "DiffSense.CompareClipboard", "DiffSense.CompareSelectedText", "DiffSense.FormatFile", "DiffSense.Group")) {
            assertNotNull("action $id is not registered", am.getAction(id))
        }
        assertEquals("Compare with DiffSense", am.getAction("DiffSense.CompareFiles").templatePresentation.text)
    }

    fun testSettingsOnlyForwardEnabledOptions() {
        val settings = DiffSenseSettings.getInstance()
        val saved = settings.state
        try {
            settings.loadState(DiffSenseSettings.State().apply { ignoreCase = true; ignorePaths = " meta.* \n\n**.ts\n" })
            val o = settings.toOptions()
            assertEquals(true, o.ignoreCase)
            assertNull("switched-off options must stay unset so a config file can enable them", o.ignoreWhitespace)
            assertEquals(listOf("meta.*", "**.ts"), o.ignorePaths)
            assertNull(o.ignoreHeaders)
        } finally {
            settings.loadState(saved)
        }
    }

    fun testCompareActionIsOnlyEnabledForOneOrTwoFiles() {
        val a = myFixture.addFileToProject("a.json", "{}").virtualFile
        val b = myFixture.addFileToProject("b.json", "{}").virtualFile
        val c = myFixture.addFileToProject("c.json", "{}").virtualFile
        val action = CompareFilesAction()
        assertEquals(ActionUpdateThread.BGT, action.actionUpdateThread)
        fun enabled(vararg files: com.intellij.openapi.vfs.VirtualFile): Boolean {
            val ctx: DataContext = SimpleDataContext.builder()
                .add(com.intellij.openapi.actionSystem.CommonDataKeys.PROJECT, project)
                .add(CommonDataKeys.VIRTUAL_FILE_ARRAY, arrayOf(*files))
                .build()
            val e = TestActionEvent.createTestEvent(action, ctx)
            action.update(e)
            return e.presentation.isEnabledAndVisible
        }
        assertFalse(enabled())
        assertTrue(enabled(a))
        assertTrue(enabled(a, b))
        assertFalse(enabled(a, b, c))
    }

    fun testRunnerComparesUnsavedEditorTextAndFillsTheSession() {
        val a = myFixture.addFileToProject("config-a.json", """{"timeout":30000,"retryCount":3,"enabled":true}""").virtualFile
        val b = myFixture.addFileToProject("config-b.json", """{"timeout":45000,"retryCount":5,"enabled":true}""").virtualFile
        DiffSenseRunner.run(project, { Side.of(a, 1 shl 20) to Side.of(b, 1 shl 20) }, openDiff = false)
        val last = DiffSenseSession.getInstance(project).last
        assertNotNull("comparison did not finish", last)
        val r = last!!.result
        assertEquals(Format.JSON, r.format)
        assertEquals(listOf("timeout", "retryCount"), r.changes.filter { it.kind == ChangeKind.MODIFIED }.map { it.path })
        assertEquals("medium", r.impact?.id)
    }

    fun testRunnerHonoursProjectConfigFile() {
        myFixture.addFileToProject(".diffsense.json", """{"defaults":{"ignorePaths":["timeout"]}}""")
        val a = myFixture.addFileToProject("x-a.json", """{"timeout":1,"other":1}""").virtualFile
        val b = myFixture.addFileToProject("x-b.json", """{"timeout":2,"other":2}""").virtualFile
        DiffSenseRunner.run(project, { Side.of(a, 1 shl 20) to Side.of(b, 1 shl 20) }, openDiff = false)
        val paths = DiffSenseSession.getInstance(project).last!!.result.changes.filter { it.kind == ChangeKind.MODIFIED }.map { it.path }
        assertEquals(listOf("other"), paths)
    }

    fun testApiComparisonThroughTheRunner() {
        val e = myFixture.addFileToProject("expected.json", """{"status":200,"body":{"amount":100}}""").virtualFile
        val a = myFixture.addFileToProject("actual.json", """{"status":200,"body":{"amount":120}}""").virtualFile
        DiffSenseRunner.run(project, { Side.of(e, 1 shl 20) to Side.of(a, 1 shl 20) }, CompareOptions(format = Format.API), openDiff = false)
        val r = DiffSenseSession.getInstance(project).last!!.result
        assertEquals(Format.API, r.format)
        assertEquals(1, r.stats.modified)
    }

    fun testOversizedFilesAreRefused() {
        // A file that is not open in an editor is read from disk, so the size limit applies to it.
        val f = myFixture.tempDirFixture.createFile("big.json", "x".repeat(2048))
        try {
            Side.of(f, 1024)
            fail("expected the size limit to be enforced")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message!!, e.message!!.contains("larger than"))
        }
        assertEquals(2048, Side.of(f, 4096).text.length)
    }

    fun testSummaryPanelBuildsForStructuredAndApiResults() {
        val panel = SummaryPanel(project)
        val json = com.razatech.diffsense.engine.compare(
            com.razatech.diffsense.engine.FileInput("a.json", """{"a":1,"b":2}"""),
            com.razatech.diffsense.engine.FileInput("b.json", """{"a":1,"b":3}"""),
        )
        panel.update(Analysis(json, Side("a.json", ""), Side("b.json", ""), CompareOptions()))
        val api = com.razatech.diffsense.engine.compare(
            com.razatech.diffsense.engine.FileInput("e.json", """{"status":200,"body":{"a":1}}"""),
            com.razatech.diffsense.engine.FileInput("a.json", """{"status":200,"body":{"a":2}}"""),
            CompareOptions(format = Format.API),
        )
        panel.update(Analysis(api, Side("e.json", ""), Side("a.json", ""), CompareOptions(format = Format.API)))
        assertTrue(panel.componentCount > 0)
    }

    fun testFormatFileSplitsEdifactAndIsOneUndoStep() {
        myFixture.configureByText("booking.edi", "UNB+X+A+B+1'FTX+AAI'UNZ+1+1'")
        myFixture.performEditorAction("DiffSense.FormatFile")
        assertEquals("UNB+X+A+B+1'\nFTX+AAI'\nUNZ+1+1'\n", myFixture.editor.document.text)
    }

    fun testFormatFileLeavesInvalidFilesUntouched() {
        myFixture.configureByText("broken.json", """{"a":""")
        myFixture.performEditorAction("DiffSense.FormatFile")
        assertEquals("""{"a":""", myFixture.editor.document.text)
    }

    fun testEdifactComparisonThroughTheRunner() {
        val a = myFixture.addFileToProject("a.edi", "UNB+X+A+B+1'LOC+7+USLAX::5'UNZ+1+1'").virtualFile
        val b = myFixture.addFileToProject("b.edi", "UNB+X+A+B+1'\nLOC+7+USOAK::5'\nUNZ+1+1'\n").virtualFile
        DiffSenseRunner.run(project, { Side.of(a, 1 shl 20) to Side.of(b, 1 shl 20) }, openDiff = false)
        val r = DiffSenseSession.getInstance(project).last!!.result
        assertEquals(Format.EDIFACT, r.format)
        assertEquals(listOf("LOC[7].2.1"), r.changes.filter { it.kind == ChangeKind.MODIFIED }.map { it.path })
        assertEquals("high", r.impact?.id)
    }
}
