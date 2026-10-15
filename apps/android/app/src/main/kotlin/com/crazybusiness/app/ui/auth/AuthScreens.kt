package com.crazybusiness.app.ui.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.crazybusiness.app.ui.common.BackBar
import com.crazybusiness.app.ui.common.FormField
import com.crazybusiness.app.ui.common.LocalContainer
import com.crazybusiness.app.ui.common.userMessage
import com.crazybusiness.app.ui.theme.Brand
import com.crazybusiness.app.ui.theme.Danger
import com.crazybusiness.app.ui.theme.Muted
import com.crazybusiness.core.api.ApiException
import com.crazybusiness.core.api.RegisterRequest
import com.crazybusiness.core.india.India
import kotlinx.coroutines.launch

@Composable
private fun Brandmark() {
    Text("CRAZY BUSINESS", color = Brand, fontWeight = FontWeight.Black, fontSize = 26.sp)
    Text("One App. Complete Business Control.", color = Muted)
}

@Composable
fun OnboardingScreen(onRegister: () -> Unit, onLogin: () -> Unit) {
    val c = LocalContainer.current
    val scope = rememberCoroutineScope()
    val points = listOf(
        "GST invoices & quotations in seconds — share on WhatsApp as PDF",
        "Stock, serial numbers and warranty, with barcode scanning",
        "Know who owes you — dues, ageing and payment reminders",
        "Works on a weak network — drafts save offline and sync later",
    )
    Column(Modifier.fillMaxSize().safeDrawingPadding().padding(24.dp), verticalArrangement = Arrangement.SpaceBetween) {
        Column {
            Spacer(Modifier.height(48.dp))
            Brandmark()
            Spacer(Modifier.height(32.dp))
            points.forEach {
                Row(Modifier.padding(vertical = 8.dp), verticalAlignment = Alignment.Top) {
                    Icon(Icons.Default.CheckCircle, null, tint = Brand)
                    Text(it, Modifier.padding(start = 12.dp))
                }
            }
        }
        Column {
            Button(onClick = { scope.launch { c.session.markOnboardingSeen(); onRegister() } }, Modifier.fillMaxWidth().height(52.dp)) { Text("Start free") }
            Spacer(Modifier.height(8.dp))
            OutlinedButton(onClick = { scope.launch { c.session.markOnboardingSeen(); onLogin() } }, Modifier.fillMaxWidth().height(52.dp)) { Text("I already have an account") }
        }
    }
}

@Composable
fun LoginScreen(onSignedIn: () -> Unit, onRegister: () -> Unit, onForgot: () -> Unit) {
    val c = LocalContainer.current
    val scope = rememberCoroutineScope()
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var totp by rememberSaveable { mutableStateOf("") }
    var needsTotp by rememberSaveable { mutableStateOf(false) }
    var busy by rememberSaveable { mutableStateOf(false) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }

    fun submit() {
        busy = true
        error = null
        scope.launch {
            try {
                val res = c.api.login(email.trim(), password, totp.takeIf { needsTotp && it.isNotBlank() })
                c.session.signedIn(res.token, res.user.fullName)
                onSignedIn()
            } catch (e: ApiException) {
                if (e.code == "MFA_REQUIRED") needsTotp = true
                error = e.message
            } catch (e: Exception) {
                error = e.userMessage()
            } finally {
                busy = false
            }
        }
    }

    Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()).padding(24.dp)) {
        Spacer(Modifier.height(32.dp))
        Brandmark()
        Spacer(Modifier.height(32.dp))
        Text("Sign in", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(16.dp))
        FormField(email, { email = it }, "Email", keyboard = KeyboardType.Email)
        FormField(password, { password = it }, "Password", password = true)
        if (needsTotp) FormField(totp, { totp = it.filter(Char::isDigit).take(6) }, "6-digit authenticator code", keyboard = KeyboardType.Number)
        error?.let { Text(it, color = Danger, modifier = Modifier.padding(vertical = 8.dp)) }
        Button(onClick = ::submit, enabled = !busy && email.isNotBlank() && password.isNotBlank(), modifier = Modifier.fillMaxWidth().padding(top = 8.dp).height(52.dp)) {
            Text(if (busy) "Signing in…" else "Sign in")
        }
        TextButton(onClick = onForgot) { Text("Forgot password?") }
        TextButton(onClick = onRegister) { Text("New here? Create a free account") }
    }
}

@Composable
fun RegisterScreen(onRegistered: () -> Unit, onLogin: () -> Unit) {
    val c = LocalContainer.current
    val scope = rememberCoroutineScope()
    var name by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var phone by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var terms by rememberSaveable { mutableStateOf(false) }
    var busy by rememberSaveable { mutableStateOf(false) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    val phoneError = if (phone.isNotBlank() && India.normalizePhone(phone) == null) "Enter a valid 10-digit Indian mobile number" else null
    val passwordOk = password.length >= 10 && password.any(Char::isLetter) && password.any(Char::isDigit)
    val passwordError = if (password.isNotEmpty() && !passwordOk) "Use at least 10 characters with letters and numbers" else null

    Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()).padding(24.dp)) {
        Spacer(Modifier.height(16.dp))
        Brandmark()
        Spacer(Modifier.height(24.dp))
        Text("Create your account", style = MaterialTheme.typography.headlineSmall)
        Text("Free plan forever. Pro features free for the trial period — no card needed.", color = Muted)
        Spacer(Modifier.height(16.dp))
        FormField(name, { name = it }, "Your name")
        FormField(email, { email = it }, "Email", keyboard = KeyboardType.Email)
        FormField(phone, { phone = it }, "Mobile (optional)", keyboard = KeyboardType.Phone, error = phoneError)
        FormField(password, { password = it }, "Password", password = true, error = passwordError)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(terms, { terms = it })
            Text("I agree to the Terms and Privacy Policy")
        }
        error?.let { Text(it, color = Danger, modifier = Modifier.padding(vertical = 8.dp)) }
        Button(
            onClick = {
                busy = true
                error = null
                scope.launch {
                    try {
                        val res = c.api.register(RegisterRequest(name.trim(), email.trim(), password, India.normalizePhone(phone), acceptTerms = true))
                        c.session.signedIn(res.token, res.user.fullName)
                        onRegistered()
                    } catch (e: Exception) {
                        error = e.userMessage()
                    } finally {
                        busy = false
                    }
                }
            },
            enabled = !busy && terms && name.isNotBlank() && email.isNotBlank() && passwordOk && phoneError == null,
            modifier = Modifier.fillMaxWidth().height(52.dp),
        ) { Text(if (busy) "Creating…" else "Create account") }
        TextButton(onClick = onLogin) { Text("Already have an account? Sign in") }
    }
}

@Composable
fun ForgotPasswordScreen(onBack: () -> Unit) {
    val c = LocalContainer.current
    val scope = rememberCoroutineScope()
    var email by rememberSaveable { mutableStateOf("") }
    var sent by rememberSaveable { mutableStateOf(false) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxSize().safeDrawingPadding()) {
        BackBar("Reset password", onBack)
        Column(Modifier.padding(24.dp)) {
            if (sent) {
                Text("If an account exists for $email, we've emailed a reset link. Open it on this phone or a computer to set a new password.")
            } else {
                Text("Enter your account email. We'll send a link to set a new password.", color = Muted)
                Spacer(Modifier.height(12.dp))
                FormField(email, { email = it }, "Email", keyboard = KeyboardType.Email)
                error?.let { Text(it, color = Danger) }
                Button(onClick = {
                    scope.launch {
                        try { c.api.forgotPassword(email.trim()); sent = true } catch (e: Exception) { error = e.userMessage() }
                    }
                }, enabled = email.contains('@'), modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) { Text("Send reset link") }
            }
        }
    }
}
