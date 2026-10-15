package com.crazybusiness.app.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.crazybusiness.app.AppContainer
import com.crazybusiness.app.ui.theme.BrandSoft
import com.crazybusiness.app.ui.theme.Danger
import com.crazybusiness.app.ui.theme.Line
import com.crazybusiness.app.ui.theme.Muted
import com.crazybusiness.app.ui.theme.Success
import com.crazybusiness.app.ui.theme.Warning
import com.crazybusiness.core.api.ApiException
import com.crazybusiness.core.india.India
import kotlinx.coroutines.CancellationException
import java.io.IOException
import java.math.BigDecimal
import java.time.LocalDate
import java.time.format.DateTimeFormatter

val LocalContainer = compositionLocalOf<AppContainer> { error("No container") }

fun Throwable.userMessage(): String = when (this) {
    is ApiException -> message
    is IOException -> "No internet connection. Check your network and try again."
    else -> "Something went wrong. Please try again."
}

sealed interface Load<out T> {
    data object Loading : Load<Nothing>
    data class Ok<T>(val value: T) : Load<T>
    data class Failed(val message: String, val offline: Boolean) : Load<Nothing>
}

class Loaded<T>(val state: Load<T>, val reload: () -> Unit)

/** Loads data from the API, re-running when [keys] change or reload() is called. */
@Composable
fun <T> rememberLoad(vararg keys: Any?, block: suspend () -> T): Loaded<T> {
    val container = LocalContainer.current
    var tick by remember { mutableIntStateOf(0) }
    val state by produceState<Load<T>>(Load.Loading, *keys, tick) {
        value = Load.Loading
        value = try {
            Load.Ok(block())
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            if (e is ApiException && e.needsLogin) container.onAuthExpired()
            Load.Failed(e.userMessage(), e is IOException)
        }
    }
    return Loaded(state) { tick++ }
}

@Composable
fun <T> LoadView(loaded: Loaded<T>, content: @Composable (T) -> Unit) {
    when (val s = loaded.state) {
        Load.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        is Load.Failed -> ErrorState(s.message, s.offline, loaded.reload)
        is Load.Ok -> content(s.value)
    }
}

@Composable
fun ErrorState(message: String, offline: Boolean, retry: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        if (offline) Icon(Icons.Default.CloudOff, null, tint = Muted)
        Spacer(Modifier.height(8.dp))
        Text(message, textAlign = TextAlign.Center, color = Muted)
        Spacer(Modifier.height(12.dp))
        OutlinedButton(onClick = retry) { Text("Try again") }
    }
}

@Composable
fun EmptyState(title: String, body: String? = null, action: (@Composable () -> Unit)? = null) {
    Column(Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(title, fontWeight = FontWeight.SemiBold)
        if (body != null) Text(body, color = Muted, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 4.dp))
        if (action != null) Box(Modifier.padding(top = 12.dp)) { action() }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BackBar(title: String, onBack: () -> Unit, actions: @Composable () -> Unit = {}) {
    TopAppBar(
        title = { Text(title, maxLines = 1) },
        navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } },
        actions = { actions() },
    )
}

@Composable
fun SectionCard(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        border = androidx.compose.foundation.BorderStroke(1.dp, Line),
    ) { Column(Modifier.padding(16.dp)) { content() } }
}

@Composable
fun StatusChip(status: String, overdue: Boolean = false) {
    val (label, fg) = when {
        overdue -> "Overdue" to Danger
        status == "paid" -> "Paid" to Success
        status == "partially_paid" -> "Part paid" to Warning
        status == "draft" -> "Draft" to Muted
        status == "cancelled" -> "Cancelled" to Muted
        status == "accepted" || status == "converted" -> status.replaceFirstChar { it.uppercase() } to Success
        else -> status.replace('_', ' ').replaceFirstChar { it.uppercase() } to MaterialTheme.colorScheme.primary
    }
    Text(
        label,
        color = fg,
        style = MaterialTheme.typography.labelSmall,
        modifier = Modifier.background(BrandSoft.copy(alpha = 0.5f), RoundedCornerShape(50)).padding(horizontal = 8.dp, vertical = 2.dp),
    )
}

@Composable
fun LabelValue(label: String, value: String, bold: Boolean = false) {
    Row(Modifier.fillMaxWidth().padding(vertical = 3.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = Muted)
        Text(value, fontWeight = if (bold) FontWeight.SemiBold else FontWeight.Normal)
    }
}

@Composable
fun FormField(
    value: String,
    onChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    keyboard: KeyboardType = KeyboardType.Text,
    password: Boolean = false,
    error: String? = null,
    singleLine: Boolean = true,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label) },
        modifier = modifier.fillMaxWidth(),
        singleLine = singleLine,
        isError = error != null,
        supportingText = error?.let { { Text(it) } },
        keyboardOptions = KeyboardOptions(keyboardType = keyboard),
        visualTransformation = if (password) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
    )
}

// ------------------------------------------------------------ formatting
fun inr(v: String?): String = India.inr(v?.toBigDecimalOrNull() ?: BigDecimal.ZERO)
fun inr(v: BigDecimal): String = India.inr(v)

private val dmy = DateTimeFormatter.ofPattern("dd MMM yyyy")
fun dateIN(iso: String?): String = iso?.take(10)?.let { runCatching { LocalDate.parse(it).format(dmy) }.getOrNull() } ?: "—"

fun docLabel(type: String) = when (type) {
    "invoice" -> "Invoice"
    "quotation" -> "Quotation"
    "credit_note" -> "Credit note"
    "purchase_bill" -> "Purchase bill"
    "sales_order" -> "Sales order"
    "proforma" -> "Proforma"
    "delivery_challan" -> "Delivery challan"
    else -> type.replace('_', ' ').replaceFirstChar { it.uppercase() }
}

val PAYMENT_METHODS = listOf("cash" to "Cash", "upi" to "UPI", "bank_transfer" to "Bank transfer", "card" to "Card", "cheque" to "Cheque", "other" to "Other")
