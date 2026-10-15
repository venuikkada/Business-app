package com.crazybusiness.app.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.ReceiptLong
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.crazybusiness.app.AppContainer
import com.crazybusiness.app.sync.SyncWorker
import com.crazybusiness.app.ui.auth.ForgotPasswordScreen
import com.crazybusiness.app.ui.auth.LoginScreen
import com.crazybusiness.app.ui.auth.OnboardingScreen
import com.crazybusiness.app.ui.auth.RegisterScreen
import com.crazybusiness.app.ui.business.BusinessPickerScreen
import com.crazybusiness.app.ui.business.CreateBusinessScreen
import com.crazybusiness.app.ui.common.LocalContainer
import com.crazybusiness.app.ui.customers.AddCustomerScreen
import com.crazybusiness.app.ui.customers.CustomerDetailScreen
import com.crazybusiness.app.ui.customers.CustomersScreen
import com.crazybusiness.app.ui.dashboard.DashboardScreen
import com.crazybusiness.app.ui.inventory.ProductDetailScreen
import com.crazybusiness.app.ui.inventory.ProductsScreen
import com.crazybusiness.app.ui.inventory.ScannerScreen
import com.crazybusiness.app.ui.more.AddExpenseScreen
import com.crazybusiness.app.ui.more.DraftsScreen
import com.crazybusiness.app.ui.more.MoreScreen
import com.crazybusiness.app.ui.more.NotificationsScreen
import com.crazybusiness.app.ui.more.OutstandingScreen
import com.crazybusiness.app.ui.sales.DocumentDetailScreen
import com.crazybusiness.app.ui.sales.DocumentEditorScreen
import com.crazybusiness.app.ui.sales.DocumentsScreen
import com.crazybusiness.core.api.ApiException
import kotlinx.coroutines.launch
import java.io.IOException

object Routes {
    const val ONBOARDING = "onboarding"
    const val LOGIN = "login"
    const val REGISTER = "register"
    const val FORGOT = "forgot"
    const val BUSINESSES = "businesses"
    const val NEW_BUSINESS = "business/new"
    const val HOME = "home"
    const val SALES = "sales"
    const val ITEMS = "items"
    const val PARTIES = "parties"
    const val MORE = "more"
    const val DOCUMENT = "document/{id}"
    const val EDITOR = "editor/{type}?partyId={partyId}"
    const val PRODUCT = "product/{id}"
    const val SCANNER = "scanner"
    const val PARTY = "party/{id}"
    const val NEW_PARTY = "party/new"
    const val OUTSTANDING = "outstanding"
    const val NEW_EXPENSE = "expense/new"
    const val NOTIFICATIONS = "notifications"
    const val DRAFTS = "drafts"

    fun document(id: String) = "document/$id"
    fun editor(type: String, partyId: String? = null) = "editor/$type" + (partyId?.let { "?partyId=$it" } ?: "")
    fun product(id: String) = "product/$id"
    fun party(id: String) = "party/$id"
}

private data class Tab(val route: String, val label: String, val icon: ImageVector)

private val TABS = listOf(
    Tab(Routes.HOME, "Home", Icons.Default.Home),
    Tab(Routes.SALES, "Sales", Icons.Default.ReceiptLong),
    Tab(Routes.ITEMS, "Items", Icons.Default.Inventory2),
    Tab(Routes.PARTIES, "Parties", Icons.Default.People),
    Tab(Routes.MORE, "More", Icons.Default.MoreHoriz),
)

/** Decides where to start: onboarding → login → business → main tabs. */
@Composable
fun CbaApp(container: AppContainer) {
    var start by remember { mutableStateOf<String?>(null) }
    val nav = rememberNavController()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    LaunchedEffect(Unit) {
        val s = container.session
        s.load()
        start = when {
            s.token == null -> if (s.onboardingSeen) Routes.LOGIN else Routes.ONBOARDING
            s.businessId == null -> Routes.BUSINESSES
            else -> try {
                container.context.value = container.api.context()
                SyncWorker.enqueue(context)
                Routes.HOME
            } catch (e: ApiException) {
                if (e.needsLogin) { s.clear(); Routes.LOGIN } else Routes.BUSINESSES
            } catch (e: IOException) {
                // Offline at launch: still open the app; screens show offline states and drafts work.
                Routes.HOME
            }
        }
    }

    LaunchedEffect(Unit) {
        container.authExpired.collect {
            container.session.clear()
            container.context.value = null
            nav.navigate(Routes.LOGIN) { popUpTo(0) }
        }
    }

    val begin = start
    if (begin == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        return
    }

    CompositionLocalProvider(LocalContainer provides container) {
        val entry by nav.currentBackStackEntryAsState()
        val route = entry?.destination?.route
        val showTabs = TABS.any { it.route == route }
        Scaffold(
            bottomBar = {
                if (showTabs) NavigationBar {
                    TABS.forEach { tab ->
                        NavigationBarItem(
                            selected = route == tab.route,
                            onClick = {
                                nav.navigate(tab.route) {
                                    popUpTo(Routes.HOME) { saveState = true }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            },
                            icon = { Icon(tab.icon, null) },
                            label = { Text(tab.label) },
                        )
                    }
                }
            },
        ) { padding ->
            Box(Modifier.padding(bottom = if (showTabs) padding.calculateBottomPadding() else androidx.compose.ui.unit.Dp(0f))) {
                AppNavHost(nav, begin, onBusinessSelected = {
                    scope.launch {
                        runCatching { container.context.value = container.api.context() }
                        SyncWorker.enqueue(context)
                        nav.navigate(Routes.HOME) { popUpTo(0) }
                    }
                })
            }
        }
    }
}

@Composable
private fun AppNavHost(nav: NavHostController, start: String, onBusinessSelected: () -> Unit) {
    val back: () -> Unit = { nav.popBackStack() }
    NavHost(nav, startDestination = start) {
        composable(Routes.ONBOARDING) {
            OnboardingScreen(onRegister = { nav.navigate(Routes.REGISTER) }, onLogin = { nav.navigate(Routes.LOGIN) })
        }
        composable(Routes.LOGIN) {
            LoginScreen(
                onSignedIn = { nav.navigate(Routes.BUSINESSES) { popUpTo(0) } },
                onRegister = { nav.navigate(Routes.REGISTER) },
                onForgot = { nav.navigate(Routes.FORGOT) },
            )
        }
        composable(Routes.REGISTER) {
            RegisterScreen(onRegistered = { nav.navigate(Routes.NEW_BUSINESS) { popUpTo(0) } }, onLogin = { nav.navigate(Routes.LOGIN) })
        }
        composable(Routes.FORGOT) { ForgotPasswordScreen(onBack = back) }
        composable(Routes.BUSINESSES) {
            BusinessPickerScreen(
                onSelected = onBusinessSelected,
                onCreate = { nav.navigate(Routes.NEW_BUSINESS) },
                onLoggedOut = { nav.navigate(Routes.LOGIN) { popUpTo(0) } },
            )
        }
        composable(Routes.NEW_BUSINESS) { CreateBusinessScreen(onCreated = onBusinessSelected) }

        composable(Routes.HOME) {
            DashboardScreen(
                openDocument = { nav.navigate(Routes.document(it)) },
                newInvoice = { nav.navigate(Routes.editor("invoice")) },
                newQuotation = { nav.navigate(Routes.editor("quotation")) },
                openOutstanding = { nav.navigate(Routes.OUTSTANDING) },
                openNotifications = { nav.navigate(Routes.NOTIFICATIONS) },
                openScanner = { nav.navigate(Routes.SCANNER) },
            )
        }
        composable(Routes.SALES) {
            DocumentsScreen(openDocument = { nav.navigate(Routes.document(it)) }, create = { type -> nav.navigate(Routes.editor(type)) })
        }
        composable(Routes.ITEMS) {
            ProductsScreen(openProduct = { nav.navigate(Routes.product(it)) }, openScanner = { nav.navigate(Routes.SCANNER) })
        }
        composable(Routes.PARTIES) {
            CustomersScreen(openParty = { nav.navigate(Routes.party(it)) }, addParty = { nav.navigate(Routes.NEW_PARTY) })
        }
        composable(Routes.MORE) {
            MoreScreen(
                open = { nav.navigate(it) },
                onSwitchBusiness = { nav.navigate(Routes.BUSINESSES) { popUpTo(0) } },
                onLoggedOut = { nav.navigate(Routes.LOGIN) { popUpTo(0) } },
            )
        }

        composable(Routes.DOCUMENT, arguments = listOf(navArgument("id") { type = NavType.StringType })) {
            DocumentDetailScreen(
                id = it.arguments!!.getString("id")!!,
                onBack = back,
                openDocument = { id -> nav.navigate(Routes.document(id)) { popUpTo(Routes.DOCUMENT) { inclusive = true } } },
            )
        }
        composable(
            Routes.EDITOR,
            arguments = listOf(
                navArgument("type") { type = NavType.StringType },
                navArgument("partyId") { type = NavType.StringType; nullable = true; defaultValue = null },
            ),
        ) {
            DocumentEditorScreen(
                type = it.arguments!!.getString("type")!!,
                initialPartyId = it.arguments?.getString("partyId"),
                onBack = back,
                onSaved = { id -> nav.navigate(Routes.document(id)) { popUpTo(Routes.EDITOR) { inclusive = true } } },
                onSavedOffline = { nav.navigate(Routes.DRAFTS) { popUpTo(Routes.EDITOR) { inclusive = true } } },
            )
        }
        composable(Routes.PRODUCT, arguments = listOf(navArgument("id") { type = NavType.StringType })) {
            ProductDetailScreen(id = it.arguments!!.getString("id")!!, onBack = back)
        }
        composable(Routes.SCANNER) {
            ScannerScreen(onBack = back, onFound = { id -> nav.navigate(Routes.product(id)) { popUpTo(Routes.SCANNER) { inclusive = true } } })
        }
        composable(Routes.NEW_PARTY) {
            AddCustomerScreen(onBack = back, onCreated = { id -> nav.navigate(Routes.party(id)) { popUpTo(Routes.NEW_PARTY) { inclusive = true } } })
        }
        composable(Routes.PARTY, arguments = listOf(navArgument("id") { type = NavType.StringType })) {
            val id = it.arguments!!.getString("id")!!
            CustomerDetailScreen(id = id, onBack = back, newInvoice = { nav.navigate(Routes.editor("invoice", id)) })
        }
        composable(Routes.OUTSTANDING) { OutstandingScreen(onBack = back, openParty = { id -> nav.navigate(Routes.party(id)) }) }
        composable(Routes.NEW_EXPENSE) { AddExpenseScreen(onBack = back) }
        composable(Routes.NOTIFICATIONS) { NotificationsScreen(onBack = back) }
        composable(Routes.DRAFTS) { DraftsScreen(onBack = back, openDocument = { nav.navigate(Routes.document(it)) }) }
    }
}
