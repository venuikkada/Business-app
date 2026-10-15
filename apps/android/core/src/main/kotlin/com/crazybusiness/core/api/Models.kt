package com.crazybusiness.core.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

// Money and quantities are transported as strings ("1234.50") to avoid
// floating-point errors; convert with toBigDecimal() in the UI.

@Serializable
data class AuthUser(
    val id: String,
    val email: String,
    val fullName: String,
    val phone: String? = null,
    val emailVerified: Boolean = false,
    val totpEnabled: Boolean = false,
)

@Serializable
data class LoginRequest(val email: String, val password: String, val totp: String? = null)

@Serializable
data class RegisterRequest(val fullName: String, val email: String, val password: String, val phone: String? = null, val acceptTerms: Boolean = true)

@Serializable
data class LoginResponse(val user: AuthUser, val token: String, val expiresAt: String)

@Serializable
data class BusinessSummary(
    val id: String,
    val name: String,
    val city: String? = null,
    val stateCode: String? = null,
    val status: String = "active",
    val roleName: String = "",
    val roleKey: String? = null,
    val planName: String? = null,
    val subscriptionStatus: String? = null,
)

@Serializable
data class MeResponse(val user: AuthUser, val businesses: List<BusinessSummary>)

@Serializable
data class Address(val line1: String? = null, val line2: String? = null, val city: String? = null, val stateCode: String? = null, val pincode: String? = null)

@Serializable
data class CreateBusinessRequest(
    val name: String,
    val stateCode: String,
    val businessType: String = "retail",
    val gstin: String? = null,
    val phone: String? = null,
    val address: Address = Address(),
    val settings: Map<String, JsonElement>? = null,
)

@Serializable
data class IdResponse(val id: String)

@Serializable
data class ContextBusiness(val id: String, val name: String, val stateCode: String, val gstin: String? = null, val status: String = "active")

@Serializable
data class BusinessSettings(
    val gstScheme: String = "regular",
    val pricesIncludeTax: Boolean = false,
    val roundOffTotals: Boolean = true,
    val upiId: String? = null,
    val defaultPaymentTermsDays: Int = 15,
)

@Serializable
data class Role(val key: String? = null, val name: String)

@Serializable
data class PlanInfo(
    val code: String,
    val name: String,
    val status: String,
    val effectiveCode: String,
    val features: Map<String, Boolean> = emptyMap(),
    val trialEndsAt: String? = null,
)

@Serializable
data class ContextResponse(
    val business: ContextBusiness,
    val settings: BusinessSettings,
    val role: Role,
    val permissions: List<String>,
    val plan: PlanInfo,
    val defaultBranchId: String,
    val isSupport: Boolean = false,
    val today: String,
) {
    fun can(p: String) = permissions.contains(p)
    fun hasFeature(f: String) = plan.features[f] == true
}

@Serializable
data class Page<T>(val items: List<T>, val total: Int, val page: Int = 1, val pageSize: Int = 25)

@Serializable
data class PartyRow(
    val id: String,
    val name: String,
    val phone: String? = null,
    val email: String? = null,
    val gstin: String? = null,
    val isCustomer: Boolean = true,
    val isSupplier: Boolean = false,
    val billingCity: String? = null,
    val balance: String? = null,
)

@Serializable
data class PartyDetail(
    val id: String,
    val name: String,
    val phone: String? = null,
    val email: String? = null,
    val gstin: String? = null,
    val isCustomer: Boolean = true,
    val isSupplier: Boolean = false,
    val balance: String = "0",
    val whatsappOptIn: Boolean = false,
    val billingAddress: Address = Address(),
    val shippingAddress: Address? = null,
) {
    /** State used for place of supply (shipping state, else billing state, else from GSTIN). */
    val supplyState: String? get() = shippingAddress?.stateCode ?: billingAddress.stateCode ?: gstin?.take(2)
}

@Serializable
data class CreatePartyRequest(
    val name: String,
    val phone: String? = null,
    val gstin: String? = null,
    val isCustomer: Boolean = true,
    val isSupplier: Boolean = false,
    val billingAddress: Address = Address(),
    val openingBalance: String = "0",
    val confirmDuplicate: Boolean = false,
)

@Serializable
data class ProductRow(
    val id: String,
    val name: String,
    val sku: String? = null,
    val barcode: String? = null,
    val type: String = "goods",
    val unit: String = "pcs",
    val hsnCode: String? = null,
    val sellingPrice: String = "0",
    val costPrice: String? = null,
    val taxRate: String = "18",
    val pricesIncludeTax: Boolean = false,
    val trackInventory: Boolean = false,
    val trackSerials: Boolean = false,
    val stock: String? = null,
    val lowStock: Boolean? = null,
    val categoryName: String? = null,
)

@Serializable
data class BranchStock(val branchId: String, val branchName: String, val quantity: String)

@Serializable
data class ProductDetail(
    val id: String,
    val name: String,
    val sku: String? = null,
    val barcode: String? = null,
    val type: String = "goods",
    val unit: String = "pcs",
    val hsnCode: String? = null,
    val sellingPrice: String = "0",
    val costPrice: String? = null,
    val taxRate: String = "18",
    val pricesIncludeTax: Boolean = false,
    val trackInventory: Boolean = false,
    val trackSerials: Boolean = false,
    val warrantyMonths: Int? = null,
    val stock: List<BranchStock> = emptyList(),
    val matchedSerial: String? = null,
) {
    val totalStock: java.math.BigDecimal get() = stock.fold(java.math.BigDecimal.ZERO) { a, s -> a + s.quantity.toBigDecimal() }
}

@Serializable
data class DocumentRow(
    val id: String,
    val docType: String,
    val number: String? = null,
    val status: String,
    val issueDate: String,
    val dueDate: String? = null,
    val partyId: String? = null,
    val partyName: String,
    val grandTotal: String,
    val balanceDue: String = "0",
    val isOverdue: Boolean = false,
)

@Serializable
data class DocumentListResponse(val items: List<DocumentRow>, val total: Int, val page: Int = 1, val pageSize: Int = 25, val sumTotal: String? = null, val sumBalance: String? = null)

@Serializable
data class DocItem(
    val id: String,
    val productId: String? = null,
    val description: String,
    val hsnCode: String? = null,
    val quantity: String,
    val unit: String,
    val unitPrice: String,
    val taxRate: String,
    val taxableValue: String,
    val total: String,
    val serialNumbers: List<String> = emptyList(),
)

@Serializable
data class DocumentDetail(
    val id: String,
    val docType: String,
    val number: String? = null,
    val status: String,
    val issueDate: String,
    val dueDate: String? = null,
    val partyId: String,
    val partyName: String,
    val partyPhone: String? = null,
    val placeOfSupply: String,
    val isInterState: Boolean,
    val taxableTotal: String,
    val cgstTotal: String,
    val sgstTotal: String,
    val igstTotal: String,
    val roundOff: String,
    val grandTotal: String,
    val amountSettled: String = "0",
    val balanceDue: String = "0",
    val shareToken: String? = null,
    val isOverdue: Boolean = false,
    val items: List<DocItem> = emptyList(),
)

@Serializable
data class DocumentItemInput(
    val productId: String? = null,
    val description: String,
    val hsnCode: String? = null,
    val quantity: String,
    val unit: String = "pcs",
    val unitPrice: String,
    val taxRate: Double,
    val discountType: String? = null,
    val discountValue: String? = null,
    val serialNumbers: List<String> = emptyList(),
)

@Serializable
data class DocumentInput(
    val docType: String,
    val partyId: String,
    val issueDate: String,
    val items: List<DocumentItemInput>,
    val pricesIncludeTax: Boolean = false,
    val roundOff: Boolean = true,
    val placeOfSupply: String? = null,
    val notes: String? = null,
)

@Serializable
data class FinalizeRequest(val approvalId: String? = null, val allowNegativeStock: Boolean = false)

@Serializable
data class ConvertRequest(val target: String, val finalize: Boolean = false)

@Serializable
data class ShareResponse(val link: String? = null, val message: String, val whatsappUrl: String)

@Serializable
data class Allocation(val documentId: String, val amount: String)

@Serializable
data class PaymentInput(
    val direction: String,
    val partyId: String,
    val amount: String,
    val method: String,
    val paidOn: String,
    val reference: String? = null,
    val notes: String? = null,
    val allocations: List<Allocation> = emptyList(),
    val autoAllocate: Boolean = false,
)

@Serializable
data class PaymentResult(val id: String, val number: String, val amount: String, val status: String)

@Serializable
data class DashboardToday(val sales: String, val invoices: Int)

@Serializable
data class DashboardPeriod(
    val sales: String? = null,
    val revenue: String? = null,
    val purchases: String? = null,
    val expenses: String? = null,
    val cashCollected: String? = null,
    val grossProfitEstimate: String? = null,
    val netProfitEstimate: String? = null,
)

@Serializable
data class DashboardDues(val receivable: String, val overdue: String, val overdueCount: Int, val payable: String? = null)

@Serializable
data class LowStockRow(val id: String, val name: String, val unit: String = "pcs", val stock: String, val reorderLevel: String = "0")

@Serializable
data class DateRange(val from: String, val to: String)

@Serializable
data class DashboardResponse(
    val range: DateRange,
    val today: DashboardToday,
    val period: DashboardPeriod,
    val dues: DashboardDues? = null,
    val lowStock: List<LowStockRow> = emptyList(),
    val recentDocuments: List<DocumentRow> = emptyList(),
)

@Serializable
data class OutstandingRow(val partyId: String, val partyName: String, val partyPhone: String? = null, val total: String, val d90Plus: String = "0", val oldestDue: String? = null)

@Serializable
data class OutstandingResponse(val asOf: String, val side: String, val items: List<OutstandingRow>)

@Serializable
data class NotificationRow(val id: String, val kind: String, val title: String, val body: String? = null, val createdAt: String, val readAt: String? = null, val entityType: String? = null, val entityId: String? = null)

@Serializable
data class NotificationsResponse(val items: List<NotificationRow>, val unread: Int)

@Serializable
data class ExpenseCategory(val id: String, val name: String)

@Serializable
data class ExpenseInput(
    val categoryId: String,
    val amount: String,
    val expenseDate: String,
    val method: String,
    val notes: String? = null,
    val confirmDuplicate: Boolean = false,
)

@Serializable
data class ErrorBody(val error: ErrorDetail)

@Serializable
data class ErrorDetail(val code: String, val message: String, val details: JsonElement? = null)

@Serializable
data class ReminderResponse(val message: String, val url: String, @SerialName("optedIn") val optedIn: Boolean = false)
