var i2c = require('i2c-bus');

var SLAVE_ADDR = 0x0B,
  bus;

(function () {

  Promise.resolve()
  .then(() => { return new Promise((resolve, reject) => {
      bus = i2c.open(1, resolve);
    })})
  .then(() => { return new Promise((resolve, reject) => {
      var buf = Buffer.from('i2cMessage');
      bus.i2cWrite(SLAVE_ADDR, buf.length, buf, resolve);
    })})
  .then(() => { return new Promise((resolve, reject) => {
      bus.close(resolve);
    })})
  .catch(reason => { throw reason; })

})();

