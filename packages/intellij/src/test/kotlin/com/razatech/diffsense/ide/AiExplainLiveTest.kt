package com.razatech.diffsense.ide

import com.razatech.diffsense.engine.AiProvider
import com.razatech.diffsense.engine.CompareOptions
import com.razatech.diffsense.engine.FileInput
import com.razatech.diffsense.engine.buildExplainPrompt
import com.razatech.diffsense.engine.compare
import com.razatech.diffsense.engine.explain
import org.junit.Assume.assumeTrue
import org.junit.Test

/** Calls the real API with the real HTTP client. Skipped unless GEMINI_API_KEY or ANTHROPIC_API_KEY is set. */
class AiExplainLiveTest {
    @Test
    fun explainsASmallJavaChange() {
        val gemini = System.getenv("GEMINI_API_KEY").orEmpty()
        val anthropic = System.getenv("ANTHROPIC_API_KEY").orEmpty()
        assumeTrue("no API key in the environment", gemini.isNotEmpty() || anthropic.isNotEmpty())
        val (provider, key) = if (anthropic.isNotEmpty()) AiProvider.ANTHROPIC to anthropic else AiProvider.GEMINI to gemini
        val r = compare(
            FileInput("A.java", "class A { void login() { driver.findElement(By.id(\"login\")).click(); } }"),
            FileInput("B.java", "class A { void login() { driver.findElement(By.cssSelector(\".login-button\")).click(); } }"),
            CompareOptions(),
        )
        val text = explain(buildExplainPrompt(r), provider, key, null, jdkHttp)
        println("LIVE ${provider.id}: $text")
        check(text.isNotBlank())
    }
}
