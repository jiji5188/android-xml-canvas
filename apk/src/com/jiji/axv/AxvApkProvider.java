package com.jiji.axv;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * M192：把自己生成的 APK 交给系统安装器。
 *
 * 为什么需要它：Android 7 起禁止 file:// 裸路径跨应用传递（FileUriExposedException）。
 * 没引 androidx，所以自己写一个最小 ContentProvider：只读、只放行「项目/build/」下的 .apk。
 */
public class AxvApkProvider extends ContentProvider {

    public static final String AUTHORITY = "com.jiji.axv.fileprovider";

    @Override
    public boolean onCreate() {
        return true;
    }

    /** content://com.jiji.axv.fileprovider/apk/<文件名> */
    private File resolve(Uri uri) throws FileNotFoundException {
        String name = uri.getLastPathSegment();
        if (name == null) throw new FileNotFoundException("空路径");
        if (name.contains("/") || name.contains("..")) throw new FileNotFoundException("非法文件名: " + name);
        File dir = new File(android.os.Environment.getExternalStorageDirectory(), "AndroidUIIDE/Project/build");
        File f = new File(dir, name);
        if (!f.isFile()) throw new FileNotFoundException("找不到: " + f.getAbsolutePath());
        return f;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        return ParcelFileDescriptor.open(resolve(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public String getType(Uri uri) {
        return "application/vnd.android.package-archive";
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sortOrder) {
        return null;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] args) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] args) {
        return 0;
    }

    /** 供 MainActivity 拼 content uri 用 */
    public static Uri uriFor(Context ctx, File apk) {
        return Uri.parse("content://" + AUTHORITY + "/apk/" + Uri.encode(apk.getName()));
    }
}
