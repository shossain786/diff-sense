package com.razatech.diffsense.engine

/**
 * Optional AI explanations. Port of `packages/core/src/explain.ts`: the AI never computes the diff,
 * it only phrases the structured changes the engines already found. Only the compact text built by
 * [buildExplainPrompt] is sent, never whole files. No I/O here: the HTTP call is injected.
 */
data class ExplainPrompt(val system: String, val user: String)

data class ExplainOptions(
    /** Longest before/after value sent, in characters. */
    val maxValueChars: Int = 120,
    /** Most changes sent. */
    val maxChanges: Int = 40,
)

/** Keep in sync with SYSTEM in packages/core/src/explain.ts. */
internal val EXPLAIN_SYSTEM = listOf(
    "You explain code and data changes to a developer reviewing them.",
    "You are given a list of structured changes that a deterministic tool already found. Do not question or recompute them, and do not invent changes that are not listed.",
    "Write a short plain-text summary: first what changed overall in one or two sentences, then the changes most likely to matter (behaviour, compatibility, test stability, risk), most important first.",
    "Impact labels are estimates from the tool; say \"likely\" when you build on them. If something cannot be known from the data (for example intent), say so rather than guessing.",
    "Be concise: no preamble, no restating every change, under 200 words.",
).joinToString(" ")

private fun clip(s: String, max: Int) = if (s.length > max) "${s.substring(0, max)}… [${s.length - max} more characters]" else s

private val WS = Regex("\\s+")

fun buildExplainPrompt(r: ComparisonResult, options: ExplainOptions = ExplainOptions()): ExplainPrompt {
    fun v(x: Any?) = clip(formatValue(x).replace(WS, " "), options.maxValueChars)
    val real = r.changes.filter { it.kind != ChangeKind.UNCHANGED }
    val lines = mutableListOf(
        "Comparison: ${r.left} vs ${r.right} (${r.format.id})",
        "Overall estimated impact: ${r.impact?.id ?: "none"}",
        "",
    )
    for (c in real.take(options.maxChanges)) {
        val what = when (c.kind) {
            ChangeKind.MODIFIED -> "${v(c.before)} -> ${v(c.after)}"
            ChangeKind.ADDED -> v(c.after)
            else -> v(c.before)
        }
        val impact = if (c.impact != null && c.impact != Impact.INFORMATIONAL) " [${c.impact.id}${c.reason?.let { ": $it" } ?: ""}]" else ""
        lines += "- ${c.kind.id} ${c.path}: $what$impact"
    }
    if (real.size > options.maxChanges) lines += "- … and ${real.size - options.maxChanges} more changes not shown"
    return ExplainPrompt(EXPLAIN_SYSTEM, lines.joinToString("\n").trimEnd())
}

enum class AiProvider(val id: String, val label: String, val defaultModel: String) {
    ANTHROPIC("anthropic", "Anthropic", "claude-haiku-5-5"),
    GEMINI("gemini", "Gemini", "gemini-3.1-flash-lite");

    companion object {
        fun byId(id: String?) = entries.firstOrNull { it.id == id } ?: ANTHROPIC
    }
}

class HttpReply(val status: Int, val body: String)

/** The one piece of I/O, supplied by the caller (and faked in tests). */
fun interface HttpPost {
    fun post(url: String, headers: Map<String, String>, body: String): HttpReply
}

class ExplainException(message: String) : Exception(message)

private fun jsonQuote(s: String): String {
    val sb = StringBuilder("\"")
    for (ch in s) when {
        ch == '"' -> sb.append("\\\"")
        ch == '\\' -> sb.append("\\\\")
        ch == '\n' -> sb.append("\\n")
        ch == '\r' -> sb.append("\\r")
        ch == '\t' -> sb.append("\\t")
        ch < ' ' -> sb.append("\\u%04x".format(ch.code))
        else -> sb.append(ch)
    }
    return sb.append('"').toString()
}

@Suppress("UNCHECKED_CAST")
private fun parseObject(body: String): Map<String, Any?>? = try {
    JsonParser.parse(body) as? Map<String, Any?>
} catch (e: ParseError) {
    null
}

/** Asks the provider to explain [prompt]. Throws [ExplainException] with a user-facing message. */
fun explain(
    prompt: ExplainPrompt,
    provider: AiProvider,
    apiKey: String,
    model: String?,
    http: HttpPost,
    baseUrl: String? = null,
): String {
    if (apiKey.isBlank()) throw ExplainException("No ${provider.label} API key set")
    val m = model?.takeIf { it.isNotBlank() } ?: provider.defaultModel
    val (url, headers, body) = when (provider) {
        AiProvider.ANTHROPIC -> Triple(
            "${baseUrl ?: "https://api.anthropic.com"}/v1/messages",
            mapOf("content-type" to "application/json", "x-api-key" to apiKey, "anthropic-version" to "2023-06-01"),
            """{"model":${jsonQuote(m)},"max_tokens":600,"system":${jsonQuote(prompt.system)},"messages":[{"role":"user","content":${jsonQuote(prompt.user)}}]}""",
        )
        AiProvider.GEMINI -> Triple(
            "${baseUrl ?: "https://generativelanguage.googleapis.com"}/v1beta/models/${java.net.URLEncoder.encode(m, "UTF-8")}:generateContent",
            mapOf("content-type" to "application/json", "x-goog-api-key" to apiKey),
            """{"systemInstruction":{"parts":[{"text":${jsonQuote(prompt.system)}}]},"contents":[{"role":"user","parts":[{"text":${jsonQuote(prompt.user)}}]}],"generationConfig":{"maxOutputTokens":1200}}""",
        )
    }
    val reply = try {
        http.post(url, headers, body)
    } catch (e: java.io.IOException) {
        throw ExplainException("Could not reach the AI service: ${e.message}")
    }
    val json = parseObject(reply.body)
    if (reply.status !in 200..299) {
        @Suppress("UNCHECKED_CAST")
        val detail = ((json?.get("error") as? Map<String, Any?>)?.get("message") as? String).orEmpty()
        val hint = when {
            provider == AiProvider.ANTHROPIC && reply.status == 401 -> " (check the API key)"
            provider == AiProvider.GEMINI && (reply.status == 400 || reply.status == 403) -> " (check the API key and model name)"
            reply.status == 429 -> " (rate limited, try again shortly)"
            else -> ""
        }
        throw ExplainException("AI service returned ${reply.status}$hint${if (detail.isNotEmpty()) ": $detail" else ""}")
    }
    @Suppress("UNCHECKED_CAST")
    val text = when (provider) {
        AiProvider.ANTHROPIC -> (json?.get("content") as? List<Any?>).orEmpty()
            .mapNotNull { it as? Map<String, Any?> }.filter { it["type"] == "text" }.joinToString("") { it["text"] as? String ?: "" }
        AiProvider.GEMINI -> ((json?.get("candidates") as? List<Any?>)?.firstOrNull() as? Map<String, Any?>)
            ?.let { (it["content"] as? Map<String, Any?>)?.get("parts") as? List<Any?> }.orEmpty()
            .mapNotNull { it as? Map<String, Any?> }.joinToString("") { it["text"] as? String ?: "" }
    }.trim()
    if (text.isEmpty()) throw ExplainException("AI service returned an empty explanation")
    return text
}
