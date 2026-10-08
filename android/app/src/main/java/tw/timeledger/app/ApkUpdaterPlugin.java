package tw.timeledger.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * 下載新版 APK 並開啟系統安裝畫面。
 * 自行安裝（非 Play 商店）的 App 無法靜默更新，最後一步一定要使用者按「更新」。
 */
@CapacitorPlugin(name = "ApkUpdater")
public class ApkUpdaterPlugin extends Plugin {

    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject result = new JSObject();
        result.put(
            "allowed",
            Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getContext().getPackageManager().canRequestPackageInstalls()
        );
        call.resolve(result);
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("缺少下載網址");
            return;
        }
        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                File dir = new File(getContext().getCacheDir(), "updates");
                if (!dir.exists() && !dir.mkdirs()) throw new Exception("無法建立暫存資料夾");
                File apk = new File(dir, "update.apk");

                // GitHub 的下載網址會轉址到 CDN，手動跟隨轉址
                URL target = new URL(url);
                boolean ok = false;
                for (int i = 0; i < 6; i++) {
                    conn = (HttpURLConnection) target.openConnection();
                    conn.setInstanceFollowRedirects(false);
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(30000);
                    int code = conn.getResponseCode();
                    if (code >= 300 && code < 400) {
                        String location = conn.getHeaderField("Location");
                        conn.disconnect();
                        conn = null;
                        if (location == null) throw new Exception("轉址失敗");
                        target = new URL(target, location);
                        continue;
                    }
                    if (code != 200) throw new Exception("HTTP " + code);
                    ok = true;
                    break;
                }
                if (!ok || conn == null) throw new Exception("轉址次數過多");

                long total = conn.getContentLengthLong();
                try (InputStream in = conn.getInputStream(); OutputStream out = new FileOutputStream(apk)) {
                    byte[] buf = new byte[64 * 1024];
                    long done = 0;
                    int lastPercent = -1;
                    int n;
                    while ((n = in.read(buf)) != -1) {
                        out.write(buf, 0, n);
                        done += n;
                        if (total > 0) {
                            int percent = (int) (done * 100 / total);
                            if (percent != lastPercent) {
                                lastPercent = percent;
                                JSObject progress = new JSObject();
                                progress.put("percent", percent);
                                notifyListeners("progress", progress);
                            }
                        }
                    }
                }

                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(uri, "application/vnd.android.package-archive");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                call.resolve();
            } catch (Exception e) {
                call.reject("下載失敗：" + e.getMessage());
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }
}
