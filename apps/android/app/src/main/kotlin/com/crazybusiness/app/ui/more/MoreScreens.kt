package com.crazybusiness.app.ui.more

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.AccountBalanceWallet
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.OpenInBrowser
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.crazybusiness.app.BuildConfig
import com.crazybusiness.app.sync.SyncWorker
import com.crazybusiness.app.ui.Routes
import com.crazybusiness.app.ui.common.BackBar
import com.crazybusiness.app.ui.common.EmptyState
import com.crazybusiness.app.ui.common.FormField
import com.crazybusiness.app.ui.common.LoadView
import com.crazybusiness.app.ui.common.LocalContainer
import com.crazybusiness.app.ui.common.PAYMENT_METHODS
import com.crazybusiness.app.ui.common.PickerField
import com.crazybusiness.app.ui.common.SectionCard
import com.crazybusiness.app.ui.common.dateIN
import com.crazybusiness.app.ui.common.docLabel
import com.crazybusiness.app.ui.common.inr
import com.crazybusiness.app.ui.common.rememberLoad
import com.crazybusiness.app.ui.common.userMessage
import com.crazybusiness.app.ui.theme.Danger
import com.crazybusiness.app.ui.theme.Muted
import com.crazybusiness.app.ui.theme.Success
import com.crazybusiness.app.util.Share
import com.crazybusiness.core.api.ApiClient
import com.crazybusiness.core.api.ExpenseInput
import com.crazybusiness.core.india.India
import kotlinx.coroutines.launch

@Composable
fun MoreScreen(open: (String) -> Unit, onSwitchBusiness: () -> Unit, onLoggedOut: () -> Unit) {
    val c = LocalContainer.current
    val ctx by c.context.collectAsState()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val businessId = c.session.businessId ?: ""
    val drafts by remember(businessId) { c.drafts.unsynced(businessId) }.collectAsState(initial = emptyList())

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        SectionCard(Modifier.padding(16.dp)) {
            Text(ctx?.business?.name ?: "", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text("Signed in as ${c.session.userName ?: ""} · ${ctx?.role?.name ?: ""}", color = Muted)
            ctx?.plan?.let { Text("Plan: ${it.name}" + (it.trialEndsAt?.let { t -> " (trial until ${dateIN(t)})" } ?: ""), color = Muted) }
        }
        @Composable
        fun row(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, trailing: String? = null, onClick: () -> Unit) {
            ListItem(
                headlineContent = { Text(label) },
                leadingContent = { Icon(icon, null) },
                trailingContent = trailing?.let { { Text(it, color = Danger) } },
                modifier = Modifier.clickable(onClick = onClick),
            )
            HorizontalDivider()
        }
        if (ctx?.can("reports.view") != false) row("Outstanding dues", Icons.Default.AccountBalanceWallet) { open(Routes.OUTSTANDING) }
        if (ctx?.can("expenses.create") != false) row("Add expense", Icons.Default.Payments) { open(Routes.NEW_EXPENSE) }
        row("Notifications", Icons.Default.Notifications) { open(Routes.NOTIFICATIONS) }
        row("Offline drafts", Icons.Default.CloudUpload, drafts.size.takeIf { it > 0 }?.toString()) { open(Routes.DRAFTS) }
        row("Open full web app (reports, settings, team)", Icons.Default.OpenInBrowser) { Share.openUrl(context, BuildConfig.API_BASE_URL + "/dashboard") }
        row("Switch business", Icons.Default.SwapHoriz, onClick = onSwitchBusiness)
        row("Sign out", Icons.AutoMirrored.Filled.Logout) {
            scope.launch {
                runCatching { c.api.logout() }
                c.session.clear()
                c.context.value = null
                onLoggedOut()
            }
        }
        Text("Version ${BuildConfig.VERSION_NAME}", color = Muted, modifier = Modifier.padding(16.dp), style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
fun OutstandingScreen(onBack: () -> Unit, openParty: (String) -> Unit) {
    val c = LocalContainer.current
    var tab by rememberSaveable { mutableStateOf(0) }
    val side = if (tab == 0) "receivable" else "payable"
    val data = rememberLoad(side) { c.api.outstanding(side) }
    Column(Modifier.fillMaxSize()) {
        BackBar("Outstanding", onBack)
        TabRow(selectedTabIndex = tab) {
            Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text("To collect") })
            Tab(selected = tab == 1, onClick = { tab = 1 }, text = { Text("To pay") })
        }
        LoadView(data) { res ->
            if (res.items.isEmpty()) EmptyState("All clear", "Nothing outstanding as of ${dateIN(res.asOf)}.")
            else LazyColumn(Modifier.fillMaxSize()) {
                item {
                    val total = res.items.fold(java.math.BigDecimal.ZERO) { a, r -> a + java.math.BigDecimal(r.total) }
                    Text("Total ${inr(total)} as of ${dateIN(res.asOf)}", fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(16.dp))
                }
                items(res.items, key = { it.partyId }) { r ->
                    Row(Modifier.fillMaxWidth().clickable { openParty(r.partyId) }.padding(horizontal = 16.dp, vertical = 12.dp)) {
                        Column(Modifier.weight(1f)) {
                            Text(r.partyName)
                            Text("Oldest due ${dateIN(r.oldestDue)}", style = MaterialTheme.typography.bodySmall, color = Muted)
                        }
                        Column(horizontalAlignment = Alignment.End) {
                            Text(inr(r.total))
                            if (java.math.BigDecimal(r.d90Plus).signum() > 0) Text("${inr(r.d90Plus)} 90+ days", style = MaterialTheme.typography.bodySmall, color = Danger)
                        }
                    }
                    HorizontalDivider()
                }
            }
        }
    }
}

@Composable
fun AddExpenseScreen(onBack: () -> Unit) {
    val c = LocalContainer.current
    val ctx by c.context.collectAsState()
    val scope = rememberCoroutineScope()
    val key = rememberSaveable { ApiClient.newIdempotencyKey() }
    val categories = rememberLoad { c.api.expenseCategories() }
    var category by rememberSaveable { mutableStateOf<String?>(null) }
    var amount by rememberSaveable { mutableStateOf("") }
    var method by rememberSaveable { mutableStateOf("cash") }
    var notes by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var saved by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().imePadding()) {
        BackBar("Add expense", onBack)
        LoadView(categories) { cats ->
            Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) {
                if (saved) {
                    Text("Expense saved.", color = Success, fontWeight = FontWeight.SemiBold)
                    OutlinedButton(onClick = onBack, modifier = Modifier.padding(top = 12.dp)) { Text("Done") }
                    return@Column
                }
                PickerField("Category", cats.map { it.id to it.name }, category, { category = it })
                FormField(amount, { amount = it.filter { ch -> ch.isDigit() || ch == '.' } }, "Amount ₹", keyboard = KeyboardType.Decimal)
                PickerField("Paid by", PAYMENT_METHODS, method, { method = it })
                FormField(notes, { notes = it }, "Notes (optional)", singleLine = false)
                error?.let { Text(it, color = Danger) }
                Button(
                    onClick = {
                        busy = true
                        scope.launch {
                            try {
                                c.api.createExpense(ExpenseInput(category!!, amount, ctx?.today ?: India.today().toString(), method, notes.ifBlank { null }), key)
                                saved = true
                            } catch (e: Exception) {
                                error = e.userMessage()
                            } finally {
                                busy = false
                            }
                        }
                    },
                    enabled = !busy && category != null && (amount.toBigDecimalOrNull()?.signum() ?: 0) > 0,
                    modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                ) { Text(if (busy) "Saving…" else "Save expense") }
            }
        }
    }
}

@Composable
fun NotificationsScreen(onBack: () -> Unit) {
    val c = LocalContainer.current
    val scope = rememberCoroutineScope()
    val data = rememberLoad { c.api.notifications() }
    Column(Modifier.fillMaxSize()) {
        BackBar("Notifications", onBack) {
            TextButton(onClick = { scope.launch { runCatching { c.api.markAllNotificationsRead() }; data.reload() } }) { Text("Mark all read") }
        }
        LoadView(data) { res ->
            if (res.items.isEmpty()) EmptyState("No notifications", "Overdue invoices, low stock, AMC renewals and approvals show up here.")
            else LazyColumn(Modifier.fillMaxSize()) {
                items(res.items, key = { it.id }) { n ->
                    ListItem(
                        headlineContent = { Text(n.title, fontWeight = if (n.readAt == null) FontWeight.SemiBold else FontWeight.Normal) },
                        supportingContent = { Text(listOfNotNull(n.body, dateIN(n.createdAt)).joinToString("\n"), color = Muted) },
                    )
                    HorizontalDivider()
                }
            }
        }
    }
}

@Composable
fun DraftsScreen(onBack: () -> Unit, openDocument: (String) -> Unit) {
    val c = LocalContainer.current
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val businessId = c.session.businessId ?: ""
    val drafts by remember(businessId) { c.drafts.unsynced(businessId) }.collectAsState(initial = emptyList())
    Column(Modifier.fillMaxSize()) {
        BackBar("Offline drafts", onBack)
        if (drafts.isEmpty()) {
            EmptyState("Everything is synced", "Invoices saved without internet appear here until they reach the server.")
            return@Column
        }
        Text(
            "These were saved on this phone without internet. They upload automatically when you're back online. Totals are estimates until the server confirms them.",
            color = Muted,
            modifier = Modifier.padding(16.dp),
        )
        OutlinedButton(onClick = { SyncWorker.enqueue(context) }, modifier = Modifier.padding(horizontal = 16.dp)) { Text("Sync now") }
        LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(drafts, key = { it.id }) { d ->
                SectionCard {
                    Text("${docLabel(d.docType)} · ${d.partyName}", fontWeight = FontWeight.SemiBold)
                    Text("≈ ${inr(d.estimatedTotal)} · ${if (d.issueOnSync) "will be issued" else "will stay a draft"}", color = Muted)
                    if (d.status == "NEEDS_ATTENTION") {
                        Text(d.error ?: "Needs attention", color = Danger)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            d.serverId?.let { id -> TextButton(onClick = { openDocument(id) }) { Text("Open") } }
                            TextButton(onClick = { scope.launch { c.drafts.retry(d.id); SyncWorker.enqueue(context) } }) { Text("Retry") }
                            TextButton(onClick = { scope.launch { c.drafts.delete(d.id) } }) { Text("Discard", color = Danger) }
                        }
                    } else {
                        Text("Waiting for internet…", color = Muted)
                    }
                }
            }
        }
    }
}
