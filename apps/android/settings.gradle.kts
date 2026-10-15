// CRAZY BUSINESS APP — Android
//
// :core is a pure Kotlin/JVM module (GST engine, API client, offline draft
// sync logic). It builds anywhere and is unit-tested against the same GST test
// vectors as the TypeScript engine.
//
// :app is the Jetpack Compose Android application. It is included only when an
// Android SDK is available (ANDROID_HOME / ANDROID_SDK_ROOT or sdk.dir in
// local.properties), e.g. in Android Studio or a CI image with the SDK.
import java.util.Properties

rootProject.name = "CrazyBusinessApp"

fun androidSdkAvailable(): Boolean {
    val env = System.getenv("ANDROID_HOME") ?: System.getenv("ANDROID_SDK_ROOT")
    if (env != null && file(env).exists()) return true
    val lp = file("local.properties")
    if (lp.exists()) {
        val p = Properties().apply { lp.inputStream().use { load(it) } }
        val dir = p.getProperty("sdk.dir")
        if (dir != null && file(dir).exists()) return true
    }
    return false
}

gradle.extra["androidSdk"] = androidSdkAvailable()

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        mavenCentral()
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
}

include(":core")
if (gradle.extra["androidSdk"] == true) {
    include(":app")
} else {
    logger.lifecycle("Android SDK not found: building :core only. Install the SDK (or open in Android Studio) to build :app.")
}
