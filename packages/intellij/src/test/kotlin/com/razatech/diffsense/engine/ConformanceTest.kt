package com.razatech.diffsense.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.math.BigDecimal

/**
 * Runs the cross-engine conformance suite (`conformance/cases.json`, generated from the TypeScript reference
 * engine). Every case must produce identical changes, stats, impact, warnings and rendered summaries.
 */
class ConformanceTest {
    @Suppress("UNCHECKED_CAST")
    private fun loadCases(): List<Map<String, Any?>> {
        val file = File("../../conformance/cases.json")
        assertTrue("missing ${file.absolutePath}", file.exists())
        return JsonParser.parse(file.readText()) as List<Map<String, Any?>>
    }

    /** Parser error wording differs between engines, and the summaries echo it in their "Note:" line. */
    private fun maskNotes(s: String) = s.replace(Regex("(fell back to text comparison) \\([^\\n]*\\)"), "$1 (…)")

    private fun mask(w: String) = w.replace(Regex("\\(.*\\)\\.?\\z", RegexOption.DOT_MATCHES_ALL), "(…)")

    /** Mirrors conformance/normalize.mjs: JSON.stringify drops undefined and turns NaN/Infinity into null. */
    private fun jsonSafe(v: Any?): Any? = when (v) {
        is Double -> if (v.isNaN() || v.isInfinite()) null else v
        is Map<*, *> -> v.mapValues { jsonSafe(it.value) }
        is List<*> -> v.map { jsonSafe(it) }
        else -> v
    }

    private fun normalize(r: ComparisonResult): Map<String, Any?> {
        val m = LinkedHashMap<String, Any?>()
        m["format"] = r.format.id
        m["stats"] = mapOf("added" to r.stats.added, "removed" to r.stats.removed, "modified" to r.stats.modified, "unchanged" to r.stats.unchanged)
        r.impact?.let { m["impact"] = it.id }
        m["warnings"] = r.warnings.map(::mask)
        m["changes"] = r.changes.map { c ->
            val cm = LinkedHashMap<String, Any?>()
            cm["path"] = c.path
            cm["kind"] = c.kind.id
            if (c.before !== Absent) cm["before"] = jsonSafe(c.before)
            if (c.after !== Absent) cm["after"] = jsonSafe(c.after)
            cm["evidence"] = c.evidence
            c.impact?.let { cm["impact"] = it.id }
            c.reason?.let { cm["reason"] = it }
            cm
        }
        return m
    }

    /** First difference between two JSON-like values, or null when equal. Numbers compare as doubles. */
    private fun firstDiff(a: Any?, b: Any?, at: String = "$"): String? = when {
        a is Map<*, *> && b is Map<*, *> -> {
            (a.keys + b.keys).toSortedSet(compareBy { it as String }).firstNotNullOfOrNull { k ->
                when {
                    !a.containsKey(k) -> "$at.$k: unexpected key in expected"
                    !b.containsKey(k) -> "$at.$k: missing in actual"
                    else -> firstDiff(a[k], b[k], "$at.$k")
                }
            }
        }
        a is List<*> && b is List<*> ->
            if (a.size != b.size) "$at: length ${a.size} vs ${b.size}"
            else a.indices.firstNotNullOfOrNull { firstDiff(a[it], b[it], "$at[$it]") }
        a is Number && b is Number -> if (numbersEqual(a, b)) null else "$at: $a vs $b"
        a == b -> null
        else -> "$at: ${a?.let { it::class.simpleName }}($a) vs ${b?.let { it::class.simpleName }}($b)"
    }

    @Test
    fun allCasesMatchTheReferenceEngine() {
        val cases = loadCases()
        assertTrue("expected the full suite, got ${cases.size} cases", cases.size >= 100)
        val failures = ArrayList<String>()
        for (c in cases) {
            val name = c["name"] as String
            try {
                @Suppress("UNCHECKED_CAST")
                fun input(k: String) = (c[k] as Map<String, Any?>).let { FileInput(it["name"] as String, it["content"] as String) }
                val opts = sanitizeOptions(c["options"])
                assertEquals("$name: bad options ${opts.errors}", 0, opts.errors.size)
                val result = compare(input("left"), input("right"), opts.value)

                firstDiff(c["expected"], normalize(result))?.let { failures.add("$name: result differs at $it") }
                val summary = maskNotes(renderSummary(result))
                val expectedSummary = maskNotes(c["summary"] as String)
                if (summary != expectedSummary) failures.add("$name: summary differs\n--- expected\n$expectedSummary--- actual\n$summary")
                val md = maskNotes(renderMarkdown(result))
                val expectedMd = maskNotes(c["markdown"] as String)
                if (md != expectedMd) failures.add("$name: markdown differs\n--- expected\n$expectedMd--- actual\n$md")
            } catch (e: Throwable) {
                failures.add("$name: threw $e")
            }
        }
        if (failures.isNotEmpty()) {
            throw AssertionError("${failures.size} of ${cases.size} cases differ:\n" + failures.take(25).joinToString("\n\n"))
        }
    }
}
