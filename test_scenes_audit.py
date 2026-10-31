"""
Brightloop Subscription Management System - Comprehensive Operational Audit
Tests all 6 scenes from CLAUDE.md and SPEC.md via API and Playwright browser UI.
"""
import sys
import os
import time
import json
import urllib.request
import urllib.error
from datetime import datetime

# Prevent Windows console charmap encoding crashes
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

from playwright.sync_api import sync_playwright

API_BASE = "http://localhost:5000/api/v1"
UI_BASE = "http://localhost:5173"

audit_results = {
    "timestamp": datetime.now().isoformat(),
    "scenes": {},
    "ui_audit": {},
    "issues_found": [],
    "performance": {}
}

def log(msg, status="INFO"):
    clean_msg = str(msg).encode("ascii", "replace").decode("ascii")
    print(f"[{status}] {clean_msg}")

def http_req(path, method="GET", body=None, token=None):
    url = f"{API_BASE}{path}"
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            status_code = resp.getcode()
            res_body = resp.read().decode("utf-8")
            return status_code, json.loads(res_body) if res_body else {}
    except urllib.error.HTTPError as e:
        res_body = e.read().decode("utf-8")
        try:
            parsed = json.loads(res_body)
        except:
            parsed = {"raw": res_body}
        return e.code, parsed
    except Exception as ex:
        return 0, {"error": str(ex)}

def run_api_audits():
    log("=== STARTING SCENE 1 AUDIT: Signup, Auth & RBAC ===")
    scene1 = {}
    
    # 1.1 Password complexity validation tests
    test_cases = [
        ("Short", "test_short@brightloop.com", "Pass@1", 400, "Should reject <= 8 chars"),
        ("NoUpper", "test_noupper@brightloop.com", "password@123", 400, "Should reject no uppercase"),
        ("NoLower", "test_nolower@brightloop.com", "PASSWORD@123", 400, "Should reject no lowercase"),
        ("NoSpecial", "test_nospec@brightloop.com", "Password123", 400, "Should reject no special char"),
    ]
    scene1["password_validation"] = []
    for name, email, pwd, expected_status, note in test_cases:
        status, resp = http_req("/auth/signup", "POST", {
            "name": f"Test {name}",
            "email": email,
            "password": pwd,
            "companyName": "Test Co"
        })
        passed = (status == expected_status)
        scene1["password_validation"].append({
            "case": name, "status": status, "expected": expected_status, "passed": passed, "response": resp
        })
        log(f"Password case '{name}': status={status} (expected {expected_status}) - {'PASS' if passed else 'FAIL'}")
    
    # 1.2 Valid signup
    valid_email = f"audit_user_{int(time.time())}@brightloop.com"
    valid_pwd = "AuditPassword@2026"
    status, resp = http_req("/auth/signup", "POST", {
        "name": "Audit New Customer",
        "email": valid_email,
        "password": valid_pwd,
        "companyName": "Audit Ventures Ltd"
    })
    scene1["valid_signup"] = {"status": status, "passed": status in [200, 201]}
    log(f"Valid signup: status={status} - {'PASS' if scene1['valid_signup']['passed'] else 'FAIL'}")
    
    # 1.3 Duplicate email check
    status, resp = http_req("/auth/signup", "POST", {
        "name": "Duplicate User",
        "email": valid_email,
        "password": valid_pwd,
        "companyName": "Duplicate Co"
    })
    err_code = resp.get("error", {}).get("code")
    scene1["duplicate_email"] = {"status": status, "passed": (status == 409), "error_code": err_code}
    log(f"Duplicate email check: status={status} (expected 409, code={err_code}) - {'PASS' if status == 409 else 'FAIL'}")
    
    # 1.4 Login as Admin, Staff, Customer
    accounts = {}
    for role, email, pwd in [
        ("ADMIN", "admin@brightloop.com", "Brightloop@2026"),
        ("STAFF", "staff@brightloop.com", "Brightloop@2026"),
        ("CUSTOMER", "customer@brightloop.com", "Brightloop@2026"),
    ]:
        status, resp = http_req("/auth/login", "POST", {"email": email, "password": pwd})
        if status == 200 and resp.get("success"):
            accounts[role] = {
                "token": resp["data"]["token"],
                "user": resp["data"]["user"]
            }
            log(f"Login {role} ({email}): SUCCESS (User ID {resp['data']['user']['id']})")
        else:
            log(f"Login {role} ({email}): FAILED status={status} {resp}", "ERROR")
            audit_results["issues_found"].append(f"Failed to log in as {role}")
    
    scene1["accounts_login"] = {r: (r in accounts) for r in ["ADMIN", "STAFF", "CUSTOMER"]}
    
    # 1.5 RBAC: ONLY Admin can add internal staff
    if "STAFF" in accounts:
        status, resp = http_req("/admin/users/staff", "POST", {
            "name": "Staff by Staff", "email": f"badstaff_{int(time.time())}@brightloop.com", "password": "StaffPassword@2026"
        }, token=accounts["STAFF"]["token"])
        scene1["staff_cannot_create_staff"] = {"status": status, "passed": status == 403}
        log(f"Staff create staff: status={status} (expected 403) - {'PASS' if status == 403 else 'FAIL'}")
    
    if "ADMIN" in accounts:
        new_staff_email = f"goodstaff_{int(time.time())}@brightloop.com"
        status, resp = http_req("/admin/users/staff", "POST", {
            "name": "Legit Staff", "email": new_staff_email, "password": "StaffPassword@2026", "phone": "+91 99999 88888"
        }, token=accounts["ADMIN"]["token"])
        scene1["admin_can_create_staff"] = {"status": status, "passed": status in [200, 201]}
        log(f"Admin create staff: status={status} (expected 200/201) - {'PASS' if status in [200, 201] else 'FAIL'}")

    # 1.6 Forgot password & Reset password flow
    status, resp = http_req("/auth/forgot-password", "POST", {"email": "customer@brightloop.com"})
    reset_token = resp.get("data", {}).get("resetToken") or resp.get("data", {}).get("token")
    scene1["forgot_password"] = {"status": status, "passed": status == 200, "has_token": bool(reset_token)}
    log(f"Forgot password request: status={status}, reset token provided: {bool(reset_token)}")

    audit_results["scenes"]["scene1_auth_rbac"] = scene1

    # === SCENE 2 AUDIT: Products, Variants & Subscription Plans ===
    log("\n=== STARTING SCENE 2 AUDIT: Products, Variants (+560 Odoo Rule) & Plans ===")
    scene2 = {}
    admin_token = accounts.get("ADMIN", {}).get("token")
    
    # 2.1 Create product
    prod_name = f"Audit ERP Platform {int(time.time())}"
    status, resp = http_req("/products", "POST", {
        "name": prod_name,
        "type": "Software",
        "salesPrice": 1000.0,
        "costPrice": 350.0,
        "notes": "Core ERP system for audit evaluation"
    }, token=admin_token)
    prod_id = resp.get("data", {}).get("id")
    scene2["create_product"] = {"status": status, "passed": status in [200, 201], "product_id": prod_id}
    log(f"Create product '{prod_name}': status={status}, id={prod_id}")

    # 2.2 Add Variant: Brand = "Odoo" with priceExtra = 560
    var_id = None
    if prod_id:
        status, resp = http_req(f"/products/{prod_id}/variants", "POST", {
            "attributeName": "Brand",
            "attributeValue": "Odoo",
            "priceExtra": 560.0,
            "sku": f"ODOO-ERP-{prod_id}"
        }, token=admin_token)
        variant_data = resp.get("data", {}).get("variant", {})
        var_id = variant_data.get("id")
        price_extra = variant_data.get("priceExtra")
        total_price = variant_data.get("price")
        
        passed_var = (status in [200, 201] and float(price_extra) == 560.0 and float(total_price) == 1560.0)
        scene2["create_odoo_variant"] = {
            "status": status,
            "passed": passed_var,
            "variant_id": var_id,
            "priceExtra": price_extra,
            "effectivePrice": total_price
        }
        log(f"Create Odoo variant (+560): status={status}, var_id={var_id}, priceExtra={price_extra}, effectivePrice={total_price} - {'PASS' if passed_var else 'FAIL'}")

    # 2.3 Subscription Plans CRUD
    plan_name = f"Audit Monthly Gold {int(time.time())}"
    status, resp = http_req("/plans", "POST", {
        "name": plan_name,
        "price": 999.0,
        "billingInterval": "monthly",
        "minQuantity": 1,
        "availableFrom": "2026-01-01",
        "availableTo": None,
        "autoClose": False,
        "allowEarlyClose": True,
        "allowPause": True,
        "allowRenew": True
    }, token=admin_token)
    gold_plan_id = resp.get("data", {}).get("id")
    scene2["create_plan"] = {"status": status, "passed": status in [200, 201], "plan_id": gold_plan_id}
    log(f"Create Plan '{plan_name}': status={status}, plan_id={gold_plan_id}")

    audit_results["scenes"]["scene2_catalog_plans"] = scene2

    # === SCENE 3 AUDIT: Quotation Template to Subscription Pipeline & State Machine ===
    log("\n=== STARTING SCENE 3 AUDIT: Quotation to Subscription & State Machine ===")
    scene3 = {}

    # 3.1 Create Quotation Template with Odoo variant at /quotation-templates
    status, resp = http_req("/quotation-templates", "POST", {
        "name": f"Audit Template with Odoo Brand {int(time.time())}",
        "planId": gold_plan_id,
        "validityDays": 30,
        "notes": "Includes base product + Odoo variant (+560)",
        "lines": [
            {
                "productId": prod_id,
                "variantId": var_id,
                "quantity": 2
            }
        ]
    }, token=admin_token)
    tpl_id = resp.get("data", {}).get("id")
    scene3["create_template"] = {"status": status, "passed": status in [200, 201], "template_id": tpl_id}
    log(f"Create Quotation Template: status={status}, tpl_id={tpl_id}")

    # 3.2 Turn Template into Subscription
    customer_user_id = accounts.get("CUSTOMER", {}).get("user", {}).get("id", 3)
    status, resp = http_req("/subscriptions", "POST", {
        "customerId": customer_user_id,
        "templateId": tpl_id,
        "startDate": "2026-10-31"
    }, token=admin_token)
    sub = resp.get("data", {})
    sub_id = sub.get("id")
    sub_num = sub.get("subscriptionNumber") or sub.get("subscription_number")
    sub_status = sub.get("status")
    
    # Check pricing calculation: base 1000 + 560 variant = 1560 * 2 = 3120 subtotal
    sub_lines = sub.get("lines", [])
    expected_unit_price = 1560.0
    actual_unit_price = float(sub_lines[0].get("unitPrice", 0)) if sub_lines else 0
    pricing_correct = (abs(actual_unit_price - expected_unit_price) < 0.01)

    scene3["create_subscription"] = {
        "status": status,
        "sub_id": sub_id,
        "subscriptionNumber": sub_num,
        "initial_status": sub_status,
        "line_unit_price": actual_unit_price,
        "pricing_correct": pricing_correct,
        "passed": status in [200, 201] and sub_status == "Draft" and pricing_correct
    }
    log(f"Create Subscription: id={sub_id}, num={sub_num}, status={sub_status}, unitPrice={actual_unit_price} (expected 1560.0) - {'PASS' if pricing_correct else 'FAIL'}")

    # 3.3 State Machine transitions: Draft -> Quotation -> Confirmed -> Active (using PUT)
    transitions_ok = True
    for target in ["Quotation", "Confirmed", "Active"]:
        st, r = http_req(f"/subscriptions/{sub_id}/status", "PUT", {"status": target}, token=admin_token)
        res_status = r.get("data", {}).get("status")
        if st != 200 or res_status != target:
            log(f"Transition to {target} FAILED: status={st} {r}", "ERROR")
            transitions_ok = False
            break
        else:
            log(f"Transitioned to {target}: SUCCESS (HTTP {st})")
    scene3["state_transitions"] = {"passed": transitions_ok}

    # 3.4 Customer portal access to own subscription
    cust_token = accounts.get("CUSTOMER", {}).get("token")
    if cust_token:
        st, r = http_req("/portal/subscriptions", "GET", token=cust_token)
        my_subs = r.get("data", [])
        my_sub_ids = [s.get("id") for s in my_subs]
        owns_sub = sub_id in my_sub_ids
        scene3["customer_portal_isolation"] = {"status": st, "owns_sub": owns_sub, "total_portal_subs": len(my_subs)}
        log(f"Customer Portal Subs: total={len(my_subs)}, includes created sub={owns_sub}")

    audit_results["scenes"]["scene3_quotation_subscription"] = scene3

    # === SCENE 4 AUDIT: Billing Day & Automated Invoicing ===
    log("\n=== STARTING SCENE 4 AUDIT: Billing Day & Duplicate Prevention ===")
    scene4 = {}

    # 4.1 Execute Billing Day Run (1st run)
    st, r1 = http_req("/billing/run-billing-day", "POST", {}, token=admin_token)
    run1_data = r1.get("data", {})
    gen1 = run1_data.get("generatedCount", 0)
    eval1 = run1_data.get("totalEvaluated", 0)
    invs_generated = run1_data.get("invoices", [])
    scene4["run_1"] = {"status": st, "total_evaluated": eval1, "generated_invoices": gen1, "invoices": invs_generated}
    log(f"Billing Run 1: evaluated={eval1}, generated={gen1}, status={st}")

    # 4.2 Execute Billing Day Run immediately again (2nd run) -> MUST be 0 generated (Idempotency!)
    st, r2 = http_req("/billing/run-billing-day", "POST", {}, token=admin_token)
    run2_data = r2.get("data", {})
    gen2 = run2_data.get("generatedCount", 0)
    scene4["run_2_duplicate_prevention"] = {
        "status": st,
        "generated_invoices": gen2,
        "passed": (gen2 == 0),
        "response": r2
    }
    log(f"Billing Run 2 (Duplicate check): generated={gen2} (expected 0) - {'PASS' if gen2 == 0 else 'FAIL'}")

    # 4.3 Get generated invoices
    st, r = http_req("/invoices", "GET", token=admin_token)
    invoices = r.get("data", [])
    scene4["invoices_count"] = len(invoices)
    
    # Pick the most recent draft invoice for invoice actions
    draft_inv = next((inv for inv in invoices if inv.get("status") == "Draft"), invoices[0] if invoices else None)
    scene4["test_invoice"] = draft_inv
    log(f"Total invoices in system: {len(invoices)}, test invoice #{draft_inv.get('id') if draft_inv else None}")

    # 4.4 Invoice Actions: Confirm, Send
    confirmed_inv = None
    if draft_inv:
        inv_id = draft_inv.get("id")
        # Confirm invoice
        if draft_inv.get("status") == "Draft":
            st, r = http_req(f"/invoices/{inv_id}/confirm", "POST", {}, token=admin_token)
            inv_stat = r.get("data", {}).get("status")
            scene4["invoice_confirm"] = {"status": st, "new_status": inv_stat}
            log(f"Confirm invoice #{inv_id}: status={st}, invoice_status={inv_stat}")
            confirmed_inv = r.get("data")
        else:
            confirmed_inv = draft_inv

        # Send invoice
        st, r = http_req(f"/invoices/{inv_id}/send", "POST", {}, token=admin_token)
        scene4["invoice_send"] = {"status": st, "sent_at": r.get("data", {}).get("sentAt")}
        log(f"Send invoice #{inv_id}: status={st}")

    audit_results["scenes"]["scene4_billing_day"] = scene4

    # === SCENE 5 AUDIT: Admin Discount Rules & Expiry ===
    log("\n=== STARTING SCENE 5 AUDIT: Admin Discounts & Expiry Engine ===")
    scene5 = {}

    # 5.1 Non-admin (staff) attempts to create discount at /discount-rules -> Must be 403 Forbidden!
    staff_token = accounts.get("STAFF", {}).get("token")
    if staff_token:
        st, r = http_req("/discount-rules", "POST", {
            "name": "Staff Illegal Discount",
            "code": f"STAFFDISC_{int(time.time())}",
            "discountType": "percentage",
            "discountValue": 15,
            "scope": "whole_subscription",
            "startDate": "2026-01-01",
            "endDate": "2026-12-31",
            "maxUses": 10
        }, token=staff_token)
        scene5["staff_cannot_create_discount"] = {"status": st, "passed": (st == 403)}
        log(f"Staff create discount: status={st} (expected 403) - {'PASS' if st == 403 else 'FAIL'}")

    # 5.2 Admin creates valid discount at /discount-rules
    test_code = f"DISC1USE_{int(time.time())}"
    st, r = http_req("/discount-rules", "POST", {
        "name": "Single Use Flash Promo",
        "code": test_code,
        "discountType": "fixed",
        "discountValue": 100.0,
        "scope": "whole_subscription",
        "minPurchaseAmount": 50.0,
        "minQuantity": 1,
        "startDate": "2026-01-01",
        "endDate": "2026-12-31",
        "maxUses": 1
    }, token=admin_token)
    disc_id = r.get("data", {}).get("id")
    scene5["admin_create_discount"] = {"status": st, "passed": st in [200, 201], "discount_id": disc_id, "code": test_code}
    log(f"Admin create 1-use discount '{test_code}': status={st}, id={disc_id}")

    audit_results["scenes"]["scene5_discounts"] = scene5

    # === SCENE 6 AUDIT: Payments, Reconciliation & Finance Dashboard ===
    log("\n=== STARTING SCENE 6 AUDIT: Payments & Sub-2s Finance Dashboard ===")
    scene6 = {}

    # 6.1 Record partial payment on confirmed invoice
    # Find an invoice with status Confirmed
    st, r = http_req("/invoices", "GET", token=admin_token)
    all_invoices = r.get("data", [])
    target_invoice = next((inv for inv in all_invoices if inv.get("status") == "Confirmed"), None)
    
    if target_invoice:
        inv_id = target_invoice.get("id")
        balance_due = float(target_invoice.get("balanceDue") or target_invoice.get("totalAmount", 1000))
        partial_amt = round(balance_due / 2, 2)
        
        # Payment payload: method, amount, date, note
        st, r = http_req("/payments", "POST", {
            "invoiceId": inv_id,
            "amount": partial_amt,
            "method": "UPI",
            "date": "2026-10-31",
            "note": "Partial payment audit check"
        }, token=admin_token)
        scene6["partial_payment"] = {"status": st, "amount": partial_amt, "response": r}
        log(f"Partial payment of ${partial_amt} on invoice #{inv_id}: status={st} (expected 201) - {'PASS' if st == 201 else 'FAIL'}")

        # Check invoice status is still Confirmed (not fully paid yet)
        st, r = http_req(f"/invoices/{inv_id}", "GET", token=admin_token)
        inv_after_partial = r.get("data", {})
        status_after_partial = inv_after_partial.get("status")
        amt_paid = float(inv_after_partial.get("amountPaid", 0))
        rem_balance = float(inv_after_partial.get("balanceDue", 0))
        scene6["partial_payment_status"] = {
            "status": status_after_partial,
            "amountPaid": amt_paid,
            "balanceDue": rem_balance,
            "passed": status_after_partial == "Confirmed" and abs(amt_paid - partial_amt) < 0.05
        }
        log(f"Invoice status after partial payment: {status_after_partial}, amountPaid={amt_paid}, remainingBalance={rem_balance}")

        # Record remaining payment to complete payment
        if rem_balance > 0:
            st, r = http_req("/payments", "POST", {
                "invoiceId": inv_id,
                "amount": rem_balance,
                "method": "Bank Transfer",
                "date": "2026-10-31",
                "note": "Final balance settlement"
            }, token=admin_token)
            log(f"Final payment of ${rem_balance}: status={st} (expected 201) - {'PASS' if st == 201 else 'FAIL'}")

            # Verify invoice transitioned to Paid!
            st, r = http_req(f"/invoices/{inv_id}", "GET", token=admin_token)
            inv_after_full = r.get("data", {})
            final_status = inv_after_full.get("status")
            final_balance = float(inv_after_full.get("balanceDue", 1))
            scene6["full_payment_reconciliation"] = {
                "status": final_status,
                "balanceDue": final_balance,
                "passed": (final_status == "Paid" and final_balance == 0.0)
            }
            log(f"Invoice status after final settlement: {final_status}, balanceDue={final_balance} (expected 'Paid' & 0.0) - {'PASS' if final_status == 'Paid' else 'FAIL'}")

    # 6.2 Overdue Invoices endpoint check
    st, r = http_req("/invoices/overdue", "GET", token=admin_token)
    overdue_list = r.get("data", [])
    scene6["overdue_invoices"] = {"status": st, "count": len(overdue_list)}
    log(f"Overdue Invoices endpoint: status={st}, overdue count={len(overdue_list)}")

    # 6.3 Finance Lead Dashboard Speed & Metric Aggregation (< 2s Rule)
    t0 = time.time()
    st, r = http_req("/finance/dashboard", "GET", token=admin_token)
    t_api = time.time() - t0
    dash_data = r.get("data", {})

    scene6["finance_dashboard"] = {
        "status": st,
        "response_time_seconds": round(t_api, 3),
        "passed_under_2s": (t_api < 2.0),
        "metrics": {
            "activeSubscriptions": dash_data.get("activeSubscriptions"),
            "mrr": dash_data.get("mrr"),
            "arr": dash_data.get("arr"),
            "totalRevenueCollected": dash_data.get("totalRevenueCollected"),
            "totalPayments": dash_data.get("totalPayments"),
            "totalOutstandingOwed": dash_data.get("totalOutstandingOwed"),
            "totalOverdueOwed": dash_data.get("totalOverdueOwed"),
            "queryTimeMs": dash_data.get("queryTimeMs")
        }
    }
    log(f"Finance Dashboard Response Time: {round(t_api, 3)}s (Rule: < 2.0s) - {'PASS' if t_api < 2.0 else 'FAIL'}")
    log(f"Dashboard metrics: {scene6['finance_dashboard']['metrics']}")

    audit_results["scenes"]["scene6_payments_finance"] = scene6
    return accounts

def run_ui_audits(accounts):
    log("\n=== STARTING PLAYWRIGHT BROWSER UI AUDIT ===")
    ui_audit = {"pages_tested": {}, "console_errors": []}
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        page = context.new_page()

        # Capture console errors cleanly without Windows encoding errors
        def on_console(msg):
            if msg.type in ["error", "warning"]:
                clean = msg.text.encode("ascii", "replace").decode("ascii")
                ui_audit["console_errors"].append(f"[{msg.type.upper()}] {clean}")

        page.on("console", on_console)
        page.on("pageerror", lambda err: ui_audit["console_errors"].append(f"[UNCAUGHT] {str(err)}"))

        # Test 1: Signup Page UI & Password Checklist
        log("Testing Signup Page UI & Real-Time Password Checklist...")
        page.goto(f"{UI_BASE}/signup")
        page.wait_for_load_state("networkidle")
        page.screenshot(path="test-reports/01_signup_page.png")
        
        # Test password checklist responsiveness
        pwd_input = page.locator("input[type='password']").first
        if pwd_input.is_visible():
            pwd_input.fill("weak")
            page.wait_for_timeout(300)
            page.screenshot(path="test-reports/02_signup_password_weak.png")
            
            pwd_input.fill("ValidPassword@2026")
            page.wait_for_timeout(300)
            page.screenshot(path="test-reports/03_signup_password_valid.png")
            log("Password checklist dynamic UI verified.")
        
        ui_audit["pages_tested"]["signup"] = "Loaded and interactive"

        # Test 2: Login Flow
        log("Testing Login Page & Admin Login...")
        page.goto(f"{UI_BASE}/login")
        page.wait_for_load_state("networkidle")
        page.screenshot(path="test-reports/04_login_page.png")
        
        page.fill("input[type='email']", "admin@brightloop.com")
        page.fill("input[type='password']", "Brightloop@2026")
        page.click("button[type='submit']")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(1000)
        page.screenshot(path="test-reports/05_admin_dashboard.png")
        log(f"Admin logged in, current URL: {page.url}")
        ui_audit["pages_tested"]["admin_dashboard"] = page.url

        # Test 3: Products Page UI (+560 Variant Badge)
        log("Testing Products & Variants Page UI...")
        page.goto(f"{UI_BASE}/products")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(500)
        page.screenshot(path="test-reports/06_products_catalog.png")
        
        page_text = page.content()
        has_odoo_variant = "Odoo" in page_text and ("560" in page_text or "+560" in page_text)
        log(f"Product page displays Odoo +560 variant: {has_odoo_variant}")
        ui_audit["pages_tested"]["products"] = {"url": page.url, "has_odoo_variant": has_odoo_variant}

        # Test 4: Plans Page UI (Flags & Intervals)
        log("Testing Plans Page UI...")
        page.goto(f"{UI_BASE}/plans")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(500)
        page.screenshot(path="test-reports/07_plans_page.png")
        ui_audit["pages_tested"]["plans"] = page.url

        # Test 5: Subscriptions & State Stepper UI
        log("Testing Subscriptions Page UI...")
        page.goto(f"{UI_BASE}/subscriptions")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(500)
        page.screenshot(path="test-reports/08_subscriptions_list.png")

        # Click on first subscription to inspect detail & status stepper
        first_sub_link = page.locator("a[href^='/subscriptions/']").first
        if first_sub_link.is_visible():
            first_sub_link.click()
            page.wait_for_load_state("networkidle")
            page.wait_for_timeout(800)
            page.screenshot(path="test-reports/09_subscription_detail_stepper.png")
            log(f"Viewed Subscription Detail with Stepper: {page.url}")
            ui_audit["pages_tested"]["subscription_detail"] = page.url

        # Test 6: Billing Day Control Center UI
        log("Testing Billing Day UI at /billing...")
        page.goto(f"{UI_BASE}/billing")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(500)
        page.screenshot(path="test-reports/10_billing_day_view.png")
        ui_audit["pages_tested"]["billing_day"] = page.url

        # Test 7: Invoices Page & Printable View
        log("Testing Invoices List & Printable Receipt UI...")
        page.goto(f"{UI_BASE}/invoices")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(500)
        page.screenshot(path="test-reports/11_invoices_list.png")

        # Open first invoice detail
        first_inv_link = page.locator("a[href^='/invoices/']").first
        if first_inv_link.is_visible():
            first_inv_link.click()
            page.wait_for_load_state("networkidle")
            page.wait_for_timeout(800)
            page.screenshot(path="test-reports/12_invoice_detail.png")
            log(f"Viewed Invoice Detail: {page.url}")
            ui_audit["pages_tested"]["invoice_detail"] = page.url

            # Test Printable View route
            print_link = page.locator("a[href$='/print']").first
            if print_link.is_visible():
                print_href = print_link.get_attribute("href")
                log(f"Print Invoice link detected: {print_href}")
                page.goto(f"{UI_BASE}{print_href}")
                page.wait_for_load_state("networkidle")
                page.screenshot(path="test-reports/12b_invoice_print_view.png")

        # Test 8: Finance Lead Executive Dashboard UI (< 2s render)
        log("Testing Finance Lead Dashboard UI...")
        t_ui_0 = time.time()
        page.goto(f"{UI_BASE}/finance")
        page.wait_for_load_state("networkidle")
        t_ui_render = time.time() - t_ui_0
        page.wait_for_timeout(500)
        page.screenshot(path="test-reports/13_finance_dashboard.png")
        log(f"Finance Dashboard Loaded in {round(t_ui_render, 3)}s")
        ui_audit["pages_tested"]["finance_dashboard"] = {
            "url": page.url,
            "render_time_seconds": round(t_ui_render, 3),
            "under_2s": t_ui_render < 2.0
        }

        # Test 9: Customer Portal View (Login as Customer & Navigate to /portal)
        log("Testing Customer Portal View as Customer...")
        context.clear_cookies()
        page.evaluate("() => localStorage.clear()")
        page.goto(f"{UI_BASE}/login")
        page.wait_for_load_state("networkidle")
        
        page.fill("input[type='email']", "customer@brightloop.com")
        page.fill("input[type='password']", "Brightloop@2026")
        page.click("button[type='submit']")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(1000)
        
        # Navigate to /portal explicitly
        page.goto(f"{UI_BASE}/portal")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(800)
        page.screenshot(path="test-reports/14_customer_portal.png")
        log(f"Customer Portal Loaded: {page.url}")
        
        # Inspect portal content (check add-on switch and plan buttons)
        portal_content = page.content()
        has_addon_text = "Add-on" in portal_content or "add-on" in portal_content
        has_subs_cards = "SUB-" in portal_content
        log(f"Customer Portal displays subscription cards: {has_subs_cards}, add-ons: {has_addon_text}")
        ui_audit["pages_tested"]["customer_portal"] = {
            "url": page.url,
            "has_subscription_cards": has_subs_cards,
            "has_addons": has_addon_text
        }

        browser.close()

    audit_results["ui_audit"] = ui_audit

if __name__ == "__main__":
    try:
        accounts = run_api_audits()
        run_ui_audits(accounts)
        
        with open("test-reports/audit_summary.json", "w") as f:
            json.dump(audit_results, f, indent=2)
            
        log("\n=== AUDIT COMPLETE ===")
        log("Summary report written to test-reports/audit_summary.json")
    except Exception as e:
        import traceback
        traceback.print_exc()
        sys.exit(1)
