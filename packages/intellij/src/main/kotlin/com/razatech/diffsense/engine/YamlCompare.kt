package com.razatech.diffsense.engine

import org.snakeyaml.engine.v2.api.Load
import org.snakeyaml.engine.v2.api.LoadSettings
import org.snakeyaml.engine.v2.schema.CoreSchema
import java.math.BigDecimal
import java.math.BigInteger

private fun toJs(v: Any?): Any? = when (v) {
    null -> null
    is Boolean, is String -> v
    is Int, is Long, is Short, is Byte -> BigDecimal.valueOf((v as Number).toLong())
    is BigInteger -> BigDecimal(v)
    is Double, is Float -> {
        val d = (v as Number).toDouble()
        if (d.isNaN() || d.isInfinite()) d else BigDecimal(d.toString())
    }
    is Map<*, *> -> convertMap(v)
    is Iterable<*> -> v.map { toJs(it) }
    else -> v.toString()
}

/**
 * Builds a map, resolving `<<` merge keys the way the reference engine does: merged keys are added where they
 * appear unless the key already exists, explicit keys always win, and earlier merge sources beat later ones.
 * (snakeyaml-engine leaves `<<` as an ordinary key.)
 */
private fun convertMap(v: Map<*, *>): Map<String, Any?> {
    val out = LinkedHashMap<String, Any?>()
    for ((k, x) in v) {
        if (k == "<<") {
            val sources = when (x) {
                is Map<*, *> -> listOf(x)
                is List<*> -> x.map { it as? Map<*, *> ?: throw ParseError("Merge sources must be maps or map aliases") }
                else -> throw ParseError("Merge sources must be maps or map aliases")
            }
            for (src in sources) for ((mk, mv) in src) {
                val key = jsString(toJs(mk))
                if (!out.containsKey(key)) out[key] = toJs(mv)
            }
        } else out[jsString(toJs(k))] = toJs(x)
    }
    return out
}

/**
 * Parses YAML (1.2 core schema) with anchors, aliases and merge keys resolved. A file with several
 * documents becomes a list of documents, so paths read `[0].key`.
 */
internal fun parseYaml(input: FileInput): Any? {
    val settings = LoadSettings.builder()
        .setSchema(CoreSchema())
        .setAllowDuplicateKeys(false)
        .build()
    val values = try {
        Load(settings).loadAllFromString(input.content.removePrefix("\uFEFF")).map { toJs(it) }
    } catch (e: RuntimeException) {
        throw ParseError("${input.name}: ${e.message?.lineSequence()?.firstOrNull() ?: "invalid YAML"}")
    }
    return if (values.size <= 1) values.firstOrNull() else values
}

internal fun compareYaml(left: FileInput, right: FileInput, options: CompareOptions): ComparisonResult {
    val changes = diffValues(parseYaml(left), parseYaml(right), options)
    return ComparisonResult(Format.YAML, left.name, right.name, changes, computeStats(changes), null, emptyList())
}
