package com.razatech.diffsense.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class ExplainTest {
    private fun json(l: String, r: String) = compare(FileInput("a.json", l), FileInput("b.json", r))
    private val prompt = ExplainPrompt("s", "u \"quoted\"\nline")

    @Test
    fun promptHasChangesButNotUnchangedContent() {
        val p = buildExplainPrompt(json("""{"a":1,"keep":"UNCHANGED-SECRET"}""", """{"a":2,"keep":"UNCHANGED-SECRET"}"""))
        assertTrue(p.user, p.user.contains("modified a: 1 -> 2"))
        assertFalse(p.user.contains("UNCHANGED-SECRET"))
        assertEquals(EXPLAIN_SYSTEM, p.system)
    }

    @Test
    fun systemPromptMatchesTheTypeScriptCore() {
        val ts = java.io.File("../core/src/explain.ts")
        if (!ts.exists()) return // plugin built outside the monorepo
        val src = ts.readText()
        // Every sentence of the Kotlin prompt must appear verbatim in the TS one, so both explain alike.
        for (sentence in EXPLAIN_SYSTEM.split(Regex("(?<=[.])\\s+(?=[A-Z])"))) assertTrue(sentence, src.contains(sentence))
    }

    @Test
    fun clipsLongValuesAndCapsChanges() {
        val big = "x".repeat(500)
        val p = buildExplainPrompt(json("""{"a":"1"}""", """{"a":"$big"}"""), ExplainOptions(maxValueChars = 20))
        assertFalse(p.user.contains(big))
        assertTrue(p.user.contains("more characters"))
        fun many(v: Int) = (0 until 10).joinToString(",", "{", "}") { "\"k$it\":$v" }
        assertTrue(buildExplainPrompt(json(many(1), many(2)), ExplainOptions(maxChanges = 3)).user.contains("7 more changes not shown"))
    }

    @Test
    fun anthropicRequestAndResponse() {
        var seen: Triple<String, Map<String, String>, String>? = null
        val text = explain(prompt, AiProvider.ANTHROPIC, "k", null, { u, h, b ->
            seen = Triple(u, h, b)
            HttpReply(200, """{"content":[{"type":"text","text":" Hello "}]}""")
        })
        assertEquals("Hello", text)
        val (url, headers, body) = seen!!
        assertEquals("https://api.anthropic.com/v1/messages", url)
        assertEquals("k", headers["x-api-key"])
        @Suppress("UNCHECKED_CAST")
        val sent = JsonParser.parse(body) as Map<String, Any?>
        assertEquals("claude-haiku-5-5", sent["model"])
        @Suppress("UNCHECKED_CAST")
        assertEquals("u \"quoted\"\nline", ((sent["messages"] as List<Map<String, Any?>>)[0])["content"])
    }

    @Test
    fun geminiKeyGoesInAHeaderNotTheUrl() {
        var seen: Triple<String, Map<String, String>, String>? = null
        val text = explain(prompt, AiProvider.GEMINI, "k", "m", { u, h, b ->
            seen = Triple(u, h, b)
            HttpReply(200, """{"candidates":[{"content":{"parts":[{"text":"Hi "},{"text":"there"}]}}]}""")
        })
        assertEquals("Hi there", text)
        val got = seen!!
        assertEquals("https://generativelanguage.googleapis.com/v1beta/models/m:generateContent", got.first)
        assertEquals("k", got.second["x-goog-api-key"])
        assertFalse(got.first.contains("k="))
    }

    private fun failure(provider: AiProvider, key: String, reply: () -> HttpReply): String =
        try {
            explain(prompt, provider, key, null, { _, _, _ -> reply() })
            fail("expected an ExplainException"); ""
        } catch (e: ExplainException) {
            e.message!!
        }

    @Test
    fun failuresBecomeReadableErrors() {
        assertTrue(failure(AiProvider.ANTHROPIC, "") { HttpReply(200, "") }.contains("No Anthropic API key"))
        val a = failure(AiProvider.ANTHROPIC, "k") { HttpReply(401, """{"error":{"message":"bad"}}""") }
        assertTrue(a, a.contains("401") && a.contains("API key") && a.contains("bad"))
        assertTrue(failure(AiProvider.GEMINI, "k") { HttpReply(404, """{"error":{"message":"gone"}}""") }.contains("404: gone"))
        assertTrue(failure(AiProvider.GEMINI, "k") { HttpReply(200, """{"candidates":[]}""") }.contains("empty"))
        assertTrue(failure(AiProvider.ANTHROPIC, "k") { HttpReply(500, "<html>") }.contains("500"))
        assertTrue(failure(AiProvider.ANTHROPIC, "k") { throw java.io.IOException("offline") }.contains("offline"))
    }
}
