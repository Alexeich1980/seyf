package ru.dorokhin.seyf;

import android.content.Context;
import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.HashMap;
import java.util.List;

import ru.rustore.sdk.core.tasks.OnFailureListener;
import ru.rustore.sdk.core.tasks.OnSuccessListener;
import ru.rustore.sdk.pay.RuStorePayClient;
import ru.rustore.sdk.pay.RuStorePayClientProvider;
import ru.rustore.sdk.pay.callback.PurchaseEventListener;
import ru.rustore.sdk.pay.model.ConsoleApplicationId;
import ru.rustore.sdk.pay.model.InvoiceId;
import ru.rustore.sdk.pay.model.PreferredPurchaseType;
import ru.rustore.sdk.pay.model.ProductId;
import ru.rustore.sdk.pay.model.ProductPurchase;
import ru.rustore.sdk.pay.model.ProductPurchaseParams;
import ru.rustore.sdk.pay.model.ProductPurchaseResult;
import ru.rustore.sdk.pay.model.ProductPurchaseStatus;
import ru.rustore.sdk.pay.model.Purchase;
import ru.rustore.sdk.pay.model.PurchaseId;
import ru.rustore.sdk.pay.model.SdkTheme;

/**
 * RuStorePay — мост к RuStore Pay SDK для РАЗОВОЙ покупки «полной версии» (NON_CONSUMABLE).
 *
 * Реальный API Pay SDK 11.1.0 (BOM ru.rustore.sdk:bom:2026.08.01), подтверждён javap по AAR:
 *   client  = new RuStorePayClientProvider().provide(context, ConsoleApplicationId, Map)
 *   purchase(ProductPurchaseParams, PreferredPurchaseType, SdkTheme, PurchaseEventListener)
 *             → ru.rustore.sdk.core.tasks.Task<ProductPurchaseResult>
 *   getPurchases(ProductType, PurchaseStatus, AcknowledgementState)  (null,null,null = все)
 *             → Task<List<Purchase>>
 *   Task: addOnSuccessListener(OnSuccessListener<T>) / addOnFailureListener(OnFailureListener)
 *   RuStorePayClient.Companion.getInstance() - готовый экземпляр, если SDK уже создал его сам
 *   (ContentProvider по meta-data console_app_id_value); иначе бросает RuStorePayClientNotCreated.
 * addOnCompleteListener в 11.1.0 нет.
 *
 * ConsoleApplicationId берём из strings.xml (rustore_console_app_id). При заглушке/пустом id
 * нативный клиент НЕ инициализируется (client()==null): purchase отвечает {ok:false, error},
 * getPurchases - {owned:false}. Pro бесплатно не выдаётся: JS остаётся на боевом адаптере RuStore
 * (плагин зарегистрирован), просто покупка не проходит.
 *
 * JS-контракт (см. www/js/payment.js → createRuStorePayment):
 *   NativePlugins.RuStorePay.purchase({productId})
 *     → {ok:true, purchaseId:'…'} | {ok:false, cancelled:true} | {ok:false, error:'…'}
 *   NativePlugins.RuStorePay.getPurchases({productId}) → {owned:true|false}
 *     owned=true ТОЛЬКО за товар с этим productId в статусе PAID/CONFIRMED; без productId -
 *     всегда false (чужой товар того же приложения Pro не открывает).
 */
@CapacitorPlugin(name = "RuStorePay")
public class RuStorePayPlugin extends Plugin {

    private RuStorePayClient payClient;

    /** Схема deeplink возврата из банковских приложений (СБП/SberPay). ДОЛЖНА совпадать с
     *  meta-data sdk_pay_scheme_value и intent-filter MainActivity в AndroidManifest.xml
     *  (1.3.0, как в «Хомяке»: без схемы SDK отвечает ApplicationSchemeWasNotProvided). */
    static final String PAY_SCHEME = "ru.dorokhin.seyf.rustore";

    /** Клиент Pay SDK. null → id не задан (заглушка) → покупка отвечает {ok:false}.
     *  1.3.0 (выпуск в RuStore с боевым id): SDK САМ инициализируется ContentProvider'ом на старте
     *  приложения по meta-data console_app_id_value (+ sdk_pay_scheme_value), а повторный provide()
     *  бросает RuStorePayClientAlreadyExist (проверено javap по pay-11.1.0.aar). Поэтому сначала
     *  берём готовый экземпляр getInstance(), и только если провайдер его не создал - provide(). */
    private RuStorePayClient client() {
        if (payClient != null) return payClient;
        payClient = clientFor(getContext());
        return payClient;
    }

    static RuStorePayClient clientFor(Context ctx) {
        String appId = consoleAppId(ctx);
        if (appId == null) return null;
        try {
            return RuStorePayClient.Companion.getInstance();
        } catch (Throwable notCreated) {
            try {
                HashMap<String, Object> cfg = new HashMap<String, Object>();
                cfg.put("scheme", PAY_SCHEME);
                return new RuStorePayClientProvider()
                    .provide(ctx.getApplicationContext(), new ConsoleApplicationId(appId), cfg);
            } catch (Throwable alreadyExist) {
                try { return RuStorePayClient.Companion.getInstance(); } catch (Throwable t) { return null; }
            }
        }
    }

    /** Возврат из банковского приложения (deeplink PAY_SCHEME) - отдать интент SDK, чтобы он
     *  довёл оплату. Зовётся из MainActivity.onCreate/onNewIntent. При заглушке id - ничего. */
    static void proceedIntent(Context ctx, Intent intent) {
        if (intent == null) return;
        try {
            RuStorePayClient c = clientFor(ctx);
            if (c != null) c.getIntentInteractor().proceedIntent(intent, SdkTheme.DARK);
        } catch (Throwable ignored) {}
    }

    /** Значение rustore_console_app_id из strings.xml или null, если это маркер-заглушка/пусто. */
    private static String consoleAppId(Context ctx) {
        try {
            int id = ctx.getResources().getIdentifier("rustore_console_app_id", "string", ctx.getPackageName());
            if (id == 0) return null;
            String v = ctx.getString(id);
            if (v == null) return null;
            v = v.trim();
            if (v.isEmpty() || v.startsWith("РАЗМЕСТИТЬ")) return null;   // заглушка из strings.xml
            return v;
        } catch (Throwable t) {
            return null;
        }
    }

    private static void resolveUnavailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("ok", false);
        ret.put("error", "RuStore Pay не сконфигурирован");
        call.resolve(ret);
    }

    @PluginMethod
    public void purchase(final PluginCall call) {
        String productId = call.getString("productId");
        if (productId == null || productId.isEmpty()) {
            call.reject("не задан productId", "NO_PRODUCT");
            return;
        }
        RuStorePayClient c = client();
        if (c == null) { resolveUnavailable(call); return; }

        ProductPurchaseParams params = new ProductPurchaseParams(
            new ProductId(productId),
            /* quantity */ null,
            /* orderId */ null,
            /* developerPayload */ null,
            /* appUserId */ null,
            /* appUserEmail */ null
        );
        c.getPurchaseInteractor()
            .purchase(params, PreferredPurchaseType.ONE_STEP, SdkTheme.DARK, new NoopPurchaseEvents())
            .addOnSuccessListener(new OnSuccessListener<ProductPurchaseResult>() {
                @Override
                public void onSuccess(ProductPurchaseResult result) {
                    JSObject ret = new JSObject();
                    ret.put("ok", true);
                    ret.put("purchaseId", extractPurchaseId(result));
                    call.resolve(ret);
                }
            })
            .addOnFailureListener(new OnFailureListener() {
                @Override
                public void onFailure(Throwable t) {
                    JSObject ret = new JSObject();
                    ret.put("ok", false);
                    if (isCancellation(t)) ret.put("cancelled", true);
                    else ret.put("error", "Платёж не прошёл");
                    call.resolve(ret);
                }
            });
    }

    @PluginMethod
    public void getPurchases(final PluginCall call) {
        final String productId = call.getString("productId");
        RuStorePayClient c = client();
        if (c == null) {
            JSObject ret = new JSObject();
            ret.put("owned", false);   // без нативного клиента владение не подтверждаем
            call.resolve(ret);
            return;
        }
        c.getPurchaseInteractor()
            .getPurchases(/* productType */ null, /* purchaseStatus */ null, /* acknowledgementState */ null)
            .addOnSuccessListener(new OnSuccessListener<List<Purchase>>() {
                @Override
                public void onSuccess(List<Purchase> purchases) {
                    JSObject ret = new JSObject();
                    ret.put("owned", ownsProduct(purchases, productId));
                    call.resolve(ret);
                }
            })
            .addOnFailureListener(new OnFailureListener() {
                @Override
                public void onFailure(Throwable t) {
                    call.reject("не удалось получить список покупок", "GET_PURCHASES_FAILED");
                }
            });
    }

    /** Владеет ли пользователь непотребляемым товаром: ProductPurchase с ИМЕННО этим id в
     *  PAID/CONFIRMED. Без productId - false (fail-closed: иначе засчиталась бы любая покупка). */
    static boolean ownsProduct(List<Purchase> purchases, String productId) {
        if (purchases == null || productId == null || productId.isEmpty()) return false;
        for (Purchase p : purchases) {
            if (!(p instanceof ProductPurchase)) continue;
            ProductPurchase pp = (ProductPurchase) p;
            ProductId id = pp.getProductId();
            boolean idMatch = id != null && productId.equals(id.getValue());
            if (!idMatch) continue;
            ProductPurchaseStatus st = pp.getStatus();
            if (st == ProductPurchaseStatus.PAID || st == ProductPurchaseStatus.CONFIRMED) return true;
        }
        return false;
    }

    private static String extractPurchaseId(ProductPurchaseResult result) {
        try {
            if (result != null && result.getPurchaseId() != null) return result.getPurchaseId().getValue();
        } catch (Throwable ignored) {}
        return null;
    }

    /** Отмена оплаты пользователем — распознаём по имени класса исключения (…Cancelled…). */
    private static boolean isCancellation(Throwable t) {
        for (Throwable c = t; c != null; c = c.getCause()) {
            String n = c.getClass().getSimpleName();
            if (n != null && n.toLowerCase().contains("cancel")) return true;
        }
        return false;
    }

    /** Обязательный слушатель событий шторки; итог покупки берём из Task, здесь ничего не делаем. */
    private static final class NoopPurchaseEvents implements PurchaseEventListener {
        @Override public void onPurchaseCreated(PurchaseId purchaseId, InvoiceId invoiceId) {}
        @Override public void onPaymentStarted(PurchaseId purchaseId, InvoiceId invoiceId) {}
        @Override public void onPaymentCompleted(PurchaseId purchaseId, InvoiceId invoiceId) {}
        @Override public void onPaymentFailed(PurchaseId purchaseId, InvoiceId invoiceId) {}
        @Override public void onPurchaseCancelled(PurchaseId purchaseId, InvoiceId invoiceId) {}
    }
}
