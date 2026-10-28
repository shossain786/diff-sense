package com.razatech.diffsense.ide

import com.intellij.credentialStore.CredentialAttributes
import com.intellij.credentialStore.Credentials
import com.intellij.credentialStore.generateServiceName
import com.intellij.ide.passwordSafe.PasswordSafe
import com.intellij.notification.NotificationType
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.ui.Messages
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextArea
import com.intellij.util.ui.JBUI
import com.razatech.diffsense.engine.AiProvider
import com.razatech.diffsense.engine.ExplainException
import com.razatech.diffsense.engine.HttpPost
import com.razatech.diffsense.engine.HttpReply
import com.razatech.diffsense.engine.buildExplainPrompt
import com.razatech.diffsense.engine.explain
import java.awt.BorderLayout
import java.awt.Dimension
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import javax.swing.Action
import javax.swing.JComponent
import javax.swing.JPanel

/** API keys live in the IDE's credential store (PasswordSafe), one per provider. */
object AiKeys {
    private fun attrs(p: AiProvider) = CredentialAttributes(generateServiceName("DiffSense", "${p.id}-api-key"))
    fun get(p: AiProvider): String? = PasswordSafe.instance.getPassword(attrs(p))
    fun set(p: AiProvider, key: String?) = PasswordSafe.instance.set(attrs(p), key?.let { Credentials("api-key", it) })
    fun clearAll() = AiProvider.entries.forEach { set(it, null) }
}

internal val jdkHttp = HttpPost { url, headers, body ->
    val client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).build()
    val req = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(60)).POST(HttpRequest.BodyPublishers.ofString(body))
    headers.forEach { (k, v) -> req.header(k, v) }
    val res = client.send(req.build(), HttpResponse.BodyHandlers.ofString())
    HttpReply(res.statusCode(), res.body())
}

/**
 * "Explain Changes (AI)": opt-in, runs only when the user asks. Sends a compact list of the changes
 * (never file contents) to the chosen provider using the user's own API key.
 */
object AiExplain {
    fun run(project: Project, analysis: Analysis?) {
        if (analysis == null) {
            DiffSenseRunner.notify(project, "Run a comparison first (Compare with DiffSense), then Explain Changes.")
            return
        }
        val result = analysis.result
        if (result.changes.all { it.kind == com.razatech.diffsense.engine.ChangeKind.UNCHANGED }) {
            DiffSenseRunner.notify(project, "No differences to explain.")
            return
        }
        val state = DiffSenseSettings.getInstance().state
        val provider = AiProvider.byId(state.aiProvider)
        val model = state.aiModel.takeIf { it.isNotBlank() }
        ProgressManager.getInstance().run(object : Task.Backgroundable(project, "DiffSense: asking AI to explain…", true) {
            private var text: String? = null
            private var error: String? = null

            override fun run(indicator: ProgressIndicator) {
                var key = AiKeys.get(provider)
                val stored = key != null
                if (key.isNullOrBlank()) {
                    ApplicationManager.getApplication().invokeAndWait {
                        key = Messages.showPasswordDialog(
                            project,
                            "Stored in the IDE credential store. Explanations send a compact list of the changes (not whole files) to the ${provider.label} API.",
                            "DiffSense: ${provider.label} API Key",
                            null,
                        )?.trim()
                    }
                }
                val apiKey = key?.takeIf { it.isNotEmpty() } ?: return
                try {
                    text = explain(buildExplainPrompt(result), provider, apiKey, model, jdkHttp)
                    if (!stored) AiKeys.set(provider, apiKey) // only keep a key that worked
                } catch (e: ExplainException) {
                    error = e.message
                    if (Regex("\\b(401|403)\\b").containsMatchIn(e.message.orEmpty())) AiKeys.set(provider, null)
                } catch (e: Exception) {
                    error = "Could not reach the AI service: ${e.message}"
                }
            }

            override fun onSuccess() {
                error?.let { DiffSenseRunner.notify(project, it, NotificationType.ERROR) }
                text?.let { ExplainDialog(project, "${analysis.left.name} ↔ ${analysis.right.name}", model ?: provider.defaultModel, it).show() }
            }
        })
    }
}

class ExplainDialog(project: Project, private val files: String, private val model: String, private val text: String) : DialogWrapper(project) {
    init {
        title = "DiffSense: AI Explanation"
        init()
    }

    override fun createCenterPanel(): JComponent {
        val area = JBTextArea(text).apply {
            isEditable = false
            lineWrap = true
            wrapStyleWord = true
            border = JBUI.Borders.empty(6)
        }
        return JPanel(BorderLayout(0, JBUI.scale(6))).apply {
            add(JBLabel("<html>$files<br/><i>Generated by $model; it may be wrong. The DiffSense summary is the source of truth.</i></html>"), BorderLayout.NORTH)
            add(JBScrollPane(area), BorderLayout.CENTER)
            preferredSize = Dimension(JBUI.scale(640), JBUI.scale(360))
        }
    }

    override fun createActions(): Array<Action> = arrayOf(okAction)
}
