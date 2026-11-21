import org.jetbrains.intellij.platform.gradle.TestFrameworkType

plugins {
    id("java")
    id("org.jetbrains.kotlin.jvm") version "2.4.20"
    id("org.jetbrains.intellij.platform") version "2.20.1"
}

group = providers.gradleProperty("pluginGroup").get()
version = providers.gradleProperty("pluginVersion").get()

repositories {
    mavenCentral()
    intellijPlatform { defaultRepositories() }
}

dependencies {
    intellijPlatform {
        // Build against the locally installed IDE instead of downloading an SDK.
        local(providers.gradleProperty("ideaPath").orElse("/snap/intellij-idea-ultimate/current"))
        testFramework(TestFrameworkType.Platform)
    }
    implementation("org.snakeyaml:snakeyaml-engine:2.9")
    implementation("com.github.javaparser:javaparser-core:3.26.4")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.opentest4j:opentest4j:1.3.0")
}

kotlin {
    jvmToolchain(21)
    // Implement platform interfaces without Kotlin generating bridges for their (deprecated/experimental) defaults.
    compilerOptions { freeCompilerArgs.add("-Xjvm-default=all") }
}

intellijPlatform {
    pluginConfiguration {
        name = providers.gradleProperty("pluginName")
        version = providers.gradleProperty("pluginVersion")
        ideaVersion {
            sinceBuild = providers.gradleProperty("pluginSinceBuild")
            untilBuild = provider { null }
        }
    }
    pluginVerification {
        ides { local(providers.gradleProperty("ideaPath").orElse("/snap/intellij-idea-ultimate/current")) }
    }
}

tasks.test {
    useJUnit()
    // The installed IDE is Ultimate; its licensed modules cannot start headlessly. Load only what the tests need.
    // Since 2026.3 (263) VCS ships as its own plugin, and the core's content modules need it; without it the
    // platform disables every plugin that depends on com.intellij, ours included.
    systemProperty("idea.load.plugins.id", "com.razatech.diffsense,com.intellij.platform.vcs")
    systemProperty("idea.load.plugins.category", "none")
}

// `./gradlew runIde` opens the repo's sample files in a sandbox IDE.
tasks.runIde { args = listOf(rootProject.projectDir.resolve("../../samples").canonicalPath) }
