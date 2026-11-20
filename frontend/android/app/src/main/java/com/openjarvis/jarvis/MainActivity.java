package com.openjarvis.jarvis;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(JarvisNativePlugin.class);
        registerPlugin(JarvisLocalModelPlugin.class);
        registerPlugin(JarvisModelLibraryPlugin.class);
        registerPlugin(JarvisInferencePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
