package com.openjarvis.jarvis;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(JarvisNativePlugin.class);
        registerPlugin(NeedleNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
