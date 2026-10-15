package com.crazybusiness.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

val Brand = Color(0xFFEA580C)
val BrandDark = Color(0xFFC2410C)
val BrandSoft = Color(0xFFFFEDD5)
val Ink = Color(0xFF1C1917)
val Muted = Color(0xFF78716C)
val Line = Color(0xFFE7E5E4)
val Success = Color(0xFF047857)
val Danger = Color(0xFFB91C1C)
val Warning = Color(0xFFB45309)

private val colors = lightColorScheme(
    primary = Brand,
    onPrimary = Color.White,
    primaryContainer = BrandSoft,
    onPrimaryContainer = BrandDark,
    secondary = Ink,
    onSecondary = Color.White,
    background = Color.White,
    onBackground = Ink,
    surface = Color.White,
    onSurface = Ink,
    surfaceVariant = Color(0xFFFAFAF9),
    onSurfaceVariant = Muted,
    outline = Line,
    outlineVariant = Line,
    error = Danger,
)

/** White + orange brand theme, light only (matches the web app and printed invoices). */
@Composable
fun CbaTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = colors,
        shapes = Shapes(small = RoundedCornerShape(8.dp), medium = RoundedCornerShape(12.dp), large = RoundedCornerShape(16.dp)),
        content = content,
    )
}
