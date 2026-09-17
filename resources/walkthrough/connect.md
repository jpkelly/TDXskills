## Test the connection

**TouchDesigner: Connect** sends a harmless expression to the bridge and reports
what came back in the **TouchDesigner Bridge** output channel:

```
[Connected] TouchDesigner at http://127.0.0.1:9980
  TouchDesigner 2025.33230
  Python: 3.11.15
```

The status bar shows `TD: Connected` while the connection is live. Click it to
disconnect.

If it fails, check that the Web Server DAT's **Active** parameter is on and that
its **Port** matches the `tdBridge.port` setting.
