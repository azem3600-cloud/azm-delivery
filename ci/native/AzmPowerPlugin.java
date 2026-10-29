package sa.azm.driver;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * عزم ماركت — إعفاء تطبيق المندوب من توفير البطارية + فتح إعدادات التشغيل التلقائي لبعض الشركات.
 */
@CapacitorPlugin(name = "AzmPower")
public class AzmPowerPlugin extends Plugin {

    private boolean isIgnoring() {
        if (Build.VERSION.SDK_INT < 23) return true;
        try {
            PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            return pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
        } catch (Exception e) {
            return false;
        }
    }

    private String manufacturer() {
        return Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase();
    }

    private boolean start(Intent i) {
        try {
            // بدون resolveActivity: في أندرويد 11+ يرجع null لتطبيقات النظام بسبب قيود رؤية الحزم
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private boolean openAppDetails() {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        i.setData(Uri.parse("package:" + getContext().getPackageName()));
        return start(i);
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("ignoring", isIgnoring());
        r.put("manufacturer", manufacturer());
        r.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(r);
    }

    @PluginMethod
    public void requestIgnore(PluginCall call) {
        JSObject r = new JSObject();
        boolean opened = false;
        if (!isIgnoring() && Build.VERSION.SDK_INT >= 23) {
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            i.setData(Uri.parse("package:" + getContext().getPackageName()));
            opened = start(i);
            if (!opened) opened = start(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
        }
        r.put("opened", opened);
        r.put("ignoring", isIgnoring());
        call.resolve(r);
    }

    @PluginMethod
    public void openAutoStart(PluginCall call) {
        String[][] targets = {
            {"com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"},
            {"com.letv.android.letvsafe", "com.letv.android.letvsafe.AutobootManageActivity"},
            {"com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"},
            {"com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity"},
            {"com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"},
            {"com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"},
            {"com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"},
            {"com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity"},
            {"com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"},
            {"com.samsung.android.lool", "com.samsung.android.sm.ui.battery.BatteryActivity"},
            {"com.asus.mobilemanager", "com.asus.mobilemanager.MainActivity"},
        };
        boolean opened = false;
        for (String[] t : targets) {
            Intent i = new Intent();
            i.setComponent(new ComponentName(t[0], t[1]));
            if (start(i)) { opened = true; break; }
        }
        if (!opened) opened = openAppDetails();
        JSObject r = new JSObject();
        r.put("opened", opened);
        call.resolve(r);
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        JSObject r = new JSObject();
        r.put("opened", openAppDetails());
        call.resolve(r);
    }
}
