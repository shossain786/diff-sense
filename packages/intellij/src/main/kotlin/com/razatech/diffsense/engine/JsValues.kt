package com.razatech.diffsense.engine

import java.math.BigDecimal

/*
 * Helpers that reproduce JavaScript semantics where the reference (TypeScript) engine relies on them, so the
 * two engines print and order things identically: whitespace, number formatting, JSON.stringify, key order.
 */

internal fun isJsSpace(c: Char): Boolean = when (c) {
    '\t', '\n', '\u000B', '\u000C', '\r', ' ', ' ', ' ', ' ', ' ', ' ', ' ', '　', '﻿' -> true
    else -> c in ' '..' '
}

internal fun jsTrim(s: String): String {
    var a = 0
    var b = s.length
    while (a < b && isJsSpace(s[a])) a++
    while (b > a && isJsSpace(s[b - 1])) b--
    return s.substring(a, b)
}

internal fun jsTrimEnd(s: String): String {
    var b = s.length
    while (b > 0 && isJsSpace(s[b - 1])) b--
    return s.substring(0, b)
}

/** `s.replace(/\s+/g, ' ')` */
internal fun collapseWs(s: String): String {
    val sb = StringBuilder(s.length)
    var inSpace = false
    for (c in s) {
        if (isJsSpace(c)) {
            if (!inSpace) sb.append(' ')
            inSpace = true
        } else {
            sb.append(c)
            inSpace = false
        }
    }
    return sb.toString()
}

private fun isArrayIndex(k: String): Boolean {
    if (k.isEmpty() || k.length > 10) return false
    if (k == "0") return true
    if (k[0] !in '1'..'9') return false
    if (!k.all { it in '0'..'9' }) return false
    return k.toLong() <= 4294967294L
}

/** `Object.keys` order: integer-like keys ascending first, then the others in insertion order. */
internal fun orderedKeys(m: Map<String, Any?>): List<String> {
    val idx = ArrayList<String>()
    val rest = ArrayList<String>()
    for (k in m.keys) if (isArrayIndex(k)) idx.add(k) else rest.add(k)
    if (idx.isEmpty()) return rest
    idx.sortBy { it.toLong() }
    return idx + rest
}

/** `String(number)` as JavaScript prints it. */
internal fun jsNumberToString(n: Number): String {
    val d = n.toDouble()
    if (d.isNaN()) return "NaN"
    if (d.isInfinite()) return if (d > 0) "Infinity" else "-Infinity"
    if (d == 0.0) return "0"
    val bd = BigDecimal(java.lang.Double.toString(Math.abs(d))).stripTrailingZeros()
    val digits = bd.unscaledValue().toString()
    val k = digits.length
    val nn = k - bd.scale() // value = 0.digits x 10^nn
    val body = when {
        nn in k..21 -> digits + "0".repeat(nn - k)
        nn in 1..21 -> digits.substring(0, nn) + "." + digits.substring(nn)
        nn in -5..0 -> "0." + "0".repeat(-nn) + digits
        else -> {
            val e = nn - 1
            val es = (if (e < 0) "-" else "+") + Math.abs(e)
            if (k == 1) digits + "e" + es else digits[0] + "." + digits.substring(1) + "e" + es
        }
    }
    return if (d < 0) "-$body" else body
}

/** `String(value)` for values that can come out of JSON/YAML. */
internal fun jsString(v: Any?): String = when (v) {
    null -> "null"
    is String -> v
    is Boolean -> v.toString()
    is Number -> jsNumberToString(v)
    is Map<*, *> -> "[object Object]"
    is List<*> -> v.joinToString(",") { if (it == null) "" else jsString(it) }
    else -> v.toString()
}

private fun quote(s: String): String {
    val sb = StringBuilder(s.length + 2)
    sb.append('"')
    var i = 0
    while (i < s.length) {
        val c = s[i]
        when {
            c == '"' -> sb.append("\\\"")
            c == '\\' -> sb.append("\\\\")
            c == '\b' -> sb.append("\\b")
            c == '\u000C' -> sb.append("\\f")
            c == '\n' -> sb.append("\\n")
            c == '\r' -> sb.append("\\r")
            c == '\t' -> sb.append("\\t")
            c < ' ' -> sb.append("\\u").append(String.format("%04x", c.code))
            Character.isHighSurrogate(c) && i + 1 < s.length && Character.isLowSurrogate(s[i + 1]) -> {
                sb.append(c).append(s[i + 1]); i++
            }
            Character.isSurrogate(c) -> sb.append("\\u").append(String.format("%04x", c.code)) // lone surrogate
            else -> sb.append(c)
        }
        i++
    }
    sb.append('"')
    return sb.toString()
}

/** `JSON.stringify(v)`; null stands for JavaScript `undefined`. */
@Suppress("UNCHECKED_CAST")
internal fun jsStringify(v: Any?): String? = when (v) {
    Absent -> null
    null -> "null"
    is String -> quote(v)
    is Boolean -> v.toString()
    is Number -> {
        val d = v.toDouble()
        if (d.isNaN() || d.isInfinite()) "null" else jsNumberToString(v)
    }
    is Map<*, *> -> {
        val m = v as Map<String, Any?>
        orderedKeys(m).mapNotNull { k -> jsStringify(m[k])?.let { quote(k) + ":" + it } }.joinToString(",", "{", "}")
    }
    is List<*> -> v.joinToString(",", "[", "]") { jsStringify(it) ?: "null" }
    else -> quote(v.toString())
}

/** Numbers behave like JavaScript doubles: 30 == 30.0, NaN is "the same value" as NaN. */
internal fun numbersEqual(a: Number, b: Number): Boolean {
    val x = a.toDouble()
    val y = b.toDouble()
    return x == y || (x.isNaN() && y.isNaN())
}

private val DECIMAL = Regex("^[+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?$")

/** `Number(str)` for a non-empty, already trimmed string; NaN when it is not numeric. */
internal fun jsToNumber(s: String): Double {
    if (DECIMAL.matches(s)) return s.toDouble()
    val sign = if (s.startsWith("-")) -1.0 else 1.0
    val body = s.removePrefix("+").removePrefix("-")
    if (body == "Infinity") return sign * Double.POSITIVE_INFINITY
    if (s.length > 2 && s[0] == '0') {
        val digits = s.substring(2)
        return when (s[1]) {
            'x', 'X' -> digits.toBigIntegerOrNull(16)?.toDouble() ?: Double.NaN
            'o', 'O' -> digits.toBigIntegerOrNull(8)?.toDouble() ?: Double.NaN
            'b', 'B' -> digits.toBigIntegerOrNull(2)?.toDouble() ?: Double.NaN
            else -> Double.NaN
        }
    }
    return Double.NaN
}

internal fun formatValue(v: Any?): String {
    if (v is String) return v
    if (v === Absent) return ""
    val s = jsStringify(v) ?: return ""
    return if (s.length > 60) s.substring(0, 57) + "..." else s
}
