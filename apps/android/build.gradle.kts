// Plugin versions live here (buildscript classpath) so the Android plugins are
// only resolved when the :app module is part of the build.
buildscript {
    val kotlinVersion = "2.1.0"
    repositories {
        mavenCentral()
        gradlePluginPortal()
        google {
        content {
            includeGroupByRegex("com\\.android.*")
            includeGroupByRegex("androidx.*")
            includeGroupByRegex("com\\.google\\.android.*")
            includeGroupByRegex("com\\.google\\.mlkit.*")
            includeGroupByRegex("com\\.google\\.firebase.*")
            includeGroupByRegex("com\\.google\\.gms.*")
            includeGroup("com.google.testing.platform")
        }
    }
    }
    dependencies {
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:$kotlinVersion")
        classpath("org.jetbrains.kotlin:kotlin-serialization:$kotlinVersion")
        if (gradle.extra["androidSdk"] == true) {
            classpath("com.android.tools.build:gradle:8.7.3")
            classpath("org.jetbrains.kotlin:compose-compiler-gradle-plugin:$kotlinVersion")
            classpath("com.google.devtools.ksp:symbol-processing-gradle-plugin:2.1.0-1.0.29")
        }
    }
}
