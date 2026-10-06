package com.razatech.diffsense.engine

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Formatter cases (`conformance/format-cases.json`, generated from the TypeScript reference engine). */
class FormatConformanceTest {
    @Test
    @Suppress("UNCHECKED_CAST")
    fun formattingMatchesTheReferenceEngine() {
        val file = File("../../conformance/format-cases.json")
        assertTrue("missing ${file.absolutePath}", file.exists())
        val cases = JsonParser.parse(file.readText()) as List<Map<String, Any?>>
        val ignoredByPlugin = setOf<String>() // YAML cases are not in the shared list: the IDE reformats YAML itself
        val failures = ArrayList<String>()
        for (c in cases) {
            val name = c["name"] as String
            if (name in ignoredByPlugin) continue
            val input = (c["input"] as Map<String, Any?>).let { FileInput(it["name"] as String, it["content"] as String) }
            val indent = (c["indent"] as? Number)?.toInt() ?: 2
            val result = runCatching { formatContent(input, indent) }
            if (c["error"] == true) {
                if (result.isSuccess) failures.add("$name: expected an error but got\n${result.getOrNull()}")
            } else if (result.isFailure) {
                failures.add("$name: threw ${result.exceptionOrNull()}")
            } else if (result.getOrNull() != c["expected"]) {
                failures.add("$name: differs\n--- expected\n${c["expected"]}--- actual\n${result.getOrNull()}")
            }
        }
        if (failures.isNotEmpty()) throw AssertionError("${failures.size} of ${cases.size} format cases differ:\n" + failures.joinToString("\n\n"))
    }
}
