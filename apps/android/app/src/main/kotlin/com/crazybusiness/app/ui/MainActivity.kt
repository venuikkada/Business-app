package com.crazybusiness.app.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import com.crazybusiness.app.CbaApplication
import com.crazybusiness.app.ui.theme.CbaTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val container = (application as CbaApplication).container
        setContent {
            CbaTheme { CbaApp(container) }
        }
    }
}
