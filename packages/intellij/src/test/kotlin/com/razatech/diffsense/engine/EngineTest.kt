package com.razatech.diffsense.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File

class EngineTest {
    private fun cmp(name: String, a: String, b: String, o: CompareOptions = CompareOptions()) =
        compare(FileInput(name, a), FileInput(name, b), o)

    @Test
    fun jsonParserIsStrict() {
        for (bad in listOf("", "{", "{\"a\":1,}", "[1,]", "{'a':1}", "01", "1.", ".5", "\"a\nb\"", "nul", "[1] x", "{\"a\" 1}", "\"\\x\"", "+1", "// c\n1")) {
            try {
                JsonParser.parse(bad)
                fail("should reject: $bad")
            } catch (e: ParseError) {
                // expected
            }
        }
        assertEquals(mapOf("a" to listOf(null, true, "x")), JsonParser.parse(" {\"a\" : [null, true, \"x\"]} ").let { m ->
            @Suppress("UNCHECKED_CAST") mapOf("a" to (m as Map<String, Any?>)["a"])
        })
        assertEquals("caf\u00e9 \uD83D\uDE00", JsonParser.parse("\"caf\\u00e9 \\ud83d\\ude00\""))
    }

    @Test
    fun numbersPrintLikeJavaScript() {
        val cases = mapOf(
            "0" to "0", "-0" to "0", "1.5" to "1.5", "30000" to "30000", "1e21" to "1e+21", "1e-7" to "1e-7",
            "0.000001" to "0.000001", "123456789012345680000" to "123456789012345680000", "-2.5e-10" to "-2.5e-10", "100" to "100",
            "0.1" to "0.1", "1e300" to "1e+300", "12345.6789" to "12345.6789",
        )
        for ((src, want) in cases) assertEquals(src, want, jsNumberToString(java.math.BigDecimal(src)))
    }

    @Test
    fun javaScriptKeyOrder() {
        val m = linkedMapOf<String, Any?>("b" to 1, "10" to 2, "2" to 3, "a" to 4, "01" to 5)
        assertEquals(listOf("2", "10", "b", "a", "01"), orderedKeys(m))
    }

    @Test
    fun configRoundTrip() {
        val parsed = parseConfig(
            """{"defaults":{"ignoreWhitespace":true,"ignorePaths":["meta.*"]},
                "formats":{"json":{"ignoreArrayOrder":true},"api":{"ignoreExtraFields":true,"ignoreHeaders":["x-a"]}}}""",
        )
        assertEquals(emptyList<String>(), parsed.errors)
        val json = resolveOptions(parsed.value, Format.JSON)
        assertEquals(true, json.ignoreWhitespace)
        assertEquals(true, json.ignoreArrayOrder)
        assertEquals(listOf("meta.*"), json.ignorePaths)
        assertNull(resolveOptions(parsed.value, Format.XML).ignoreArrayOrder)
        assertEquals(false, resolveOptions(parsed.value, Format.XML, CompareOptions(ignoreWhitespace = false)).ignoreWhitespace)
        assertEquals(listOf("x-a"), resolveOptions(parsed.value, Format.API).ignoreHeaders)
    }

    @Test
    fun configReportsProblemsWithoutThrowing() {
        assertTrue(parseConfig("{").errors[0].startsWith("Invalid JSON"))
        val errors = parseConfig("""{"defaults":{"ignoreCase":"yes","bogus":1},"formats":{"cobol":{}},"x":1}""").errors
        assertTrue(errors.containsAll(listOf(
            "x: unknown key", "defaults.ignoreCase: expected boolean", "defaults.bogus: unknown option", "formats.cobol: unknown format",
        )))
    }

    @Test
    fun scalesWithTheNumberOfEditsNotFileSize() {
        val n = 20000
        fun gen(d: Int) = (0 until n).joinToString("\n") { "line " + if (it % 500 == 0) "${it}x$d" else "$it" }
        val t0 = System.nanoTime()
        val r = cmp("a.txt", gen(0), gen(1))
        assertEquals(emptyList<String>(), r.warnings)
        assertEquals(ChangeStats(0, 0, 40, n - 40), r.stats)
        assertTrue("took too long", (System.nanoTime() - t0) / 1_000_000 < 3000)
    }

    @Test
    fun hugeJsonStaysFast() {
        fun mk(d: Int) = "{\"items\":[" + (0 until 60000).joinToString(",") { "{\"id\":$it,\"name\":\"item$it\",\"v\":${it + d},\"tags\":[\"a\",\"b\"]}" } + "]}"
        val a = mk(0)
        val b = mk(1)
        val t0 = System.nanoTime()
        val r = cmp("a.json", a, b)
        assertEquals(60000, r.stats.modified)
        assertTrue("took ${(System.nanoTime() - t0) / 1_000_000} ms", (System.nanoTime() - t0) / 1_000_000 < 8000)
    }

    @Test
    fun xmlExternalEntitiesAreNotResolved() {
        val secret = File.createTempFile("secret", ".txt").apply { writeText("TOP-SECRET-CONTENT"); deleteOnExit() }
        val xml = "<?xml version=\"1.0\"?><!DOCTYPE r [<!ENTITY x SYSTEM \"file://${secret.absolutePath}\">]><r>&x;</r>"
        val r = cmp("a.xml", xml, "<r>ok</r>")
        assertFalse(r.toString().contains("TOP-SECRET-CONTENT"))
        assertFalse(renderMarkdown(r).contains("TOP-SECRET-CONTENT"))
    }

    @Test
    fun javaFilesFallBackToTextWithAnExplanation() {
        val r = cmp("A.java", "class A {}", "class B {}")
        assertEquals(Format.TEXT, r.format)
        assertTrue(r.warnings.single().contains("not available in the IntelliJ plugin yet"))
    }

    @Test
    fun ignoreRulesAreCaseAndOrderAware() {
        val a = """{"id":1,"meta":{"ts":1},"t":[1,2,3]}"""
        val b = """{"id":1,"meta":{"ts":2},"t":[3,1,2]}"""
        assertEquals(0, cmp("a.json", a, b, CompareOptions(ignorePaths = listOf("meta"), ignoreArrayOrder = true)).stats.let { it.added + it.removed + it.modified })
        assertTrue(cmp("a.json", a, b).stats.modified > 0)
    }
}
