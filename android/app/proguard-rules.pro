-keepattributes JavascriptInterface,Annotation,Signature,InnerClasses,EnclosingMethod

-keep class xyz.siloneedsleep.veluna.MainActivity {
    static native <methods>;
    native <methods>;
}

-keepclasseswithmembernames class * {
    native <methods>;
}

-keepclassmembers class xyz.siloneedsleep.veluna.** {
    @android.webkit.JavascriptInterface <methods>;
}

-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

-keep class xyz.siloneedsleep.veluna.MainActivity$* {
    @android.webkit.JavascriptInterface <methods>;
}

-keep public class xyz.siloneedsleep.veluna.MainActivity
-keep public class xyz.siloneedsleep.veluna.PlaybackService
-keep public class xyz.siloneedsleep.veluna.PlayerWidget

-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
