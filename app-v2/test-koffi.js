const koffi = require('koffi');
koffi.struct('irsdk_varBuf', { tickCount: 'int32' });
try {
  koffi.struct('irsdk_varBuf', { tickCount: 'int32' });
  console.log("Success");
} catch (e) {
  console.log("Error:", e.message);
}
