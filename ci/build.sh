#!/usr/bin/env bash
# بناء الموقع + تطبيق أندرويد APK (يُشغَّل تلقائياً من GitHub Actions)
set -euxo pipefail
ROOT="$(pwd)"
RUN_NUMBER="${RUN_NUMBER:-1}"

# ---------------------------------------------------------------- 1) المكتبات
mkdir -p /tmp/v && cd /tmp/v && npm init -y >/dev/null
npm i --no-audit --no-fund @supabase/supabase-js@2.45.4 leaflet@1.9.4 xlsx@0.18.5
cd "$ROOT"
mkdir -p web/vendor/leaflet
cp /tmp/v/node_modules/@supabase/supabase-js/dist/umd/supabase.js web/vendor/supabase.js
cp -r /tmp/v/node_modules/leaflet/dist/* web/vendor/leaflet/
cp /tmp/v/node_modules/xlsx/dist/xlsx.full.min.js web/vendor/xlsx.full.min.js
ls -la web/vendor

# أصوات التنبيه
python3 ci/make_sounds.py web/sounds

# ---------------------------------------------------------------- 2) مشروع أندرويد (Capacitor)
cd "$ROOT/android"
npm install --no-audit --no-fund
rm -rf www && mkdir www
cp -r ../web/* www/
cp www/driver.html www/index.html
rm -f www/sw.js www/manifest.json
# الإشعارات الفورية تشتغل فقط لو ملف Firebase موجود (سر GitHub: GOOGLE_SERVICES_JSON)
set +x  # لا نطبع ملف Firebase في سجل البناء
if [ -n "${GOOGLE_SERVICES_JSON:-}" ]; then PUSH_ON=true; else PUSH_ON=false; fi
set -x
echo "window.AZM_PUSH = ${PUSH_ON};" > www/js/native-flags.js
npx cap add android
if [ "$PUSH_ON" = true ]; then
  set +x
  printf '%s' "$GOOGLE_SERVICES_JSON" > android/app/google-services.json
  set -x
  python3 -c "import json;d=json.load(open('android/app/google-services.json'));assert any(c['client_info']['android_client_info']['package_name']=='sa.azm.driver' for c in d['client']),'google-services.json لا يحتوي sa.azm.driver'"
fi
# إضافة إعفاء البطارية (AzmPower)
JAVA_DIR=android/app/src/main/java/sa/azm/driver
cp ../ci/native/AzmPowerPlugin.java "$JAVA_DIR/"
cat > "$JAVA_DIR/MainActivity.java" <<'JAVA'
package sa.azm.driver;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AzmPowerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
JAVA
mkdir -p android/app/src/main/res/raw && cp ../web/sounds/driver.wav android/app/src/main/res/raw/azm_driver.wav
mkdir -p assets && cp icon.png assets/icon-only.png
npx capacitor-assets generate --android --iconBackgroundColor "#0f766e" --splashBackgroundColor "#0f766e" || echo "assets generation skipped"

python3 - <<'PY'
p = "android/app/src/main/AndroidManifest.xml"
s = open(p, encoding="utf-8").read()
perms = """
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.VIBRATE" />
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
    <uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />
    <uses-feature android:name="android.hardware.location.gps" android:required="false" />
"""
tag = '<uses-permission android:name="android.permission.INTERNET" />'
assert tag in s, "INTERNET permission line not found"
s = s.replace(tag, tag + perms, 1)
open(p, "w", encoding="utf-8").write(s)
sp = "android/app/src/main/res/values/strings.xml"
t = open(sp, encoding="utf-8").read()
t = t.replace("</resources>", '    <string name="capacitor_background_geolocation_notification_channel_name">تتبع الموقع</string>\n</resources>')
open(sp, "w", encoding="utf-8").write(t)
PY

sed -i "s/versionCode 1$/versionCode ${RUN_NUMBER}/; s/versionName \"1.0\"/versionName \"1.0.${RUN_NUMBER}\"/" android/app/build.gradle
npx cap sync android
cat android/app/src/main/AndroidManifest.xml

# ---------------------------------------------------------------- 3) بناء APK موقّع
cd "$ROOT/android/android"
chmod +x gradlew
./gradlew assembleRelease --no-daemon --stacktrace
BT=$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)
"$BT/zipalign" -f -p 4 app/build/outputs/apk/release/app-release-unsigned.apk /tmp/aligned.apk
"$BT/apksigner" sign --ks ../release.jks --ks-key-alias azm --ks-pass pass:azmDriver2026 --key-pass pass:azmDriver2026 \
  --out "$ROOT/web/azm-driver.apk" /tmp/aligned.apk
"$BT/apksigner" verify "$ROOT/web/azm-driver.apk"
ls -la "$ROOT/web/azm-driver.apk"

# ---------------------------------------------------------------- 4) ملفات الإعداد مع الموقع
cd "$ROOT"
mkdir -p web/setup && cp -r supabase/* web/setup/
