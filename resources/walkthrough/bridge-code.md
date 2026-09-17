## The bridge callback

TouchDesigner listens for code using a **Web Server DAT**. The DAT needs a callback
script, which this extension ships for you.

Running **Show Bridge Callback Code** opens that script in an editor. Save it
somewhere your TD project can reach — next to your `.toe` file works well.

The callback receives a JSON body over HTTP and runs the code on TD's **main
thread**, which is the only place TD objects can safely be touched.
