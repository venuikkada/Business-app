package com.crazybusiness.core.india

import java.math.BigDecimal
import java.math.RoundingMode
import java.time.LocalDate
import java.time.ZoneId

/** Indian formats shared by the Android app (mirrors packages/core/src/india.ts). */
object India {
    val IST: ZoneId = ZoneId.of("Asia/Kolkata")

    val STATES: List<Pair<String, String>> = listOf(
        "01" to "Jammu and Kashmir", "02" to "Himachal Pradesh", "03" to "Punjab", "04" to "Chandigarh", "05" to "Uttarakhand",
        "06" to "Haryana", "07" to "Delhi", "08" to "Rajasthan", "09" to "Uttar Pradesh", "10" to "Bihar", "11" to "Sikkim",
        "12" to "Arunachal Pradesh", "13" to "Nagaland", "14" to "Manipur", "15" to "Mizoram", "16" to "Tripura", "17" to "Meghalaya",
        "18" to "Assam", "19" to "West Bengal", "20" to "Jharkhand", "21" to "Odisha", "22" to "Chhattisgarh", "23" to "Madhya Pradesh",
        "24" to "Gujarat", "26" to "Dadra and Nagar Haveli and Daman and Diu", "27" to "Maharashtra", "29" to "Karnataka", "30" to "Goa",
        "31" to "Lakshadweep", "32" to "Kerala", "33" to "Tamil Nadu", "34" to "Puducherry", "35" to "Andaman and Nicobar Islands",
        "36" to "Telangana", "37" to "Andhra Pradesh", "38" to "Ladakh", "97" to "Other Territory",
    )

    fun stateName(code: String?): String = STATES.firstOrNull { it.first == code }?.second ?: ""

    fun today(): LocalDate = LocalDate.now(IST)

    private const val GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"

    fun gstinCheckChar(first14: String): Char {
        var sum = 0
        for (i in 0 until 14) {
            val v = GSTIN_CHARS.indexOf(first14[i])
            if (v < 0) return '?'
            val p = v * (if (i % 2 == 0) 1 else 2)
            sum += p / 36 + p % 36
        }
        return GSTIN_CHARS[(36 - sum % 36) % 36]
    }

    /** Format + state + checksum validation. Does not verify registration on the GST portal. */
    fun validateGstin(input: String): String? {
        val g = input.trim().uppercase()
        if (!Regex("^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$").matches(g)) return "GSTIN must be 15 characters like 29ABCDE1234F1Z5"
        if (STATES.none { it.first == g.substring(0, 2) }) return "Unknown state code in GSTIN"
        if (gstinCheckChar(g.substring(0, 14)) != g[14]) return "GSTIN checksum does not match"
        return null
    }

    fun normalizePhone(input: String): String? {
        var d = input.replace(Regex("[^\\d+]"), "")
        when {
            d.startsWith("+") -> { if (!d.startsWith("+91")) return null; d = d.substring(3) }
            d.startsWith("0091") -> d = d.substring(4)
            d.length == 12 && d.startsWith("91") -> d = d.substring(2)
            d.length == 11 && d.startsWith("0") -> d = d.substring(1)
        }
        return if (Regex("^[6-9]\\d{9}$").matches(d)) "+91$d" else null
    }

    fun formatPhone(e164: String?): String {
        val m = Regex("^\\+91(\\d{5})(\\d{5})$").find(e164 ?: return "") ?: return e164
        return "+91 ${m.groupValues[1]} ${m.groupValues[2]}"
    }

    /** Indian digit grouping: 1,23,45,678.90 */
    fun groupIndian(value: BigDecimal, decimals: Int = 2): String {
        val v = value.setScale(decimals, RoundingMode.HALF_UP)
        val neg = v.signum() < 0
        val plain = v.abs().toPlainString()
        val intPart = plain.substringBefore('.')
        val frac = if (decimals > 0) "." + plain.substringAfter('.', "0".repeat(decimals)) else ""
        val grouped = if (intPart.length <= 3) intPart else {
            val last3 = intPart.takeLast(3)
            val rest = intPart.dropLast(3).reversed().chunked(2).joinToString(",").reversed()
            "$rest,$last3"
        }
        return (if (neg) "-" else "") + grouped + frac
    }

    fun inr(value: BigDecimal): String = (if (value.signum() < 0) "-₹" else "₹") + groupIndian(value.abs())

    fun financialYear(date: LocalDate, startMonth: Int = 4): String {
        val start = if (date.monthValue >= startMonth) date.year else date.year - 1
        return "$start-${((start + 1) % 100).toString().padStart(2, '0')}"
    }

    private val ONES = listOf("", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen")
    private val TENS = listOf("", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety")
    private fun two(n: Int) = if (n < 20) ONES[n] else TENS[n / 10] + if (n % 10 != 0) " " + ONES[n % 10] else ""
    private fun three(n: Int) = listOfNotNull(if (n / 100 > 0) "${ONES[n / 100]} Hundred" else null, if (n % 100 > 0) two(n % 100) else null).joinToString(" ")

    fun numberToWords(n0: Long): String {
        if (n0 == 0L) return "Zero"
        var n = n0
        val parts = mutableListOf<String>()
        val crore = n / 10_000_000; n %= 10_000_000
        val lakh = (n / 100_000).toInt(); n %= 100_000
        val thousand = (n / 1000).toInt(); n %= 1000
        if (crore > 0) parts += "${numberToWords(crore)} Crore"
        if (lakh > 0) parts += "${two(lakh)} Lakh"
        if (thousand > 0) parts += "${two(thousand)} Thousand"
        if (n > 0) parts += three(n.toInt())
        return parts.joinToString(" ")
    }

    fun amountInWords(amount: BigDecimal): String {
        val v = amount.abs().setScale(2, RoundingMode.HALF_UP)
        val rupees = v.toBigInteger().toLong()
        val paise = v.subtract(BigDecimal(rupees)).movePointRight(2).toInt()
        return "Rupees ${numberToWords(rupees)}" + (if (paise > 0) " and ${two(paise)} Paise" else "") + " Only"
    }
}
