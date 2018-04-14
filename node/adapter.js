var i2c = require('i2c-bus');

var SLAVE_ADDR = 0x0B,
  bus;

(function () {

  Promise.resolve()
  .then(() => { return new Promise((resolve, reject) => {
      bus = i2c.open(1, (err, data) => err ? reject(err) : resolve());
    })})
  .then(() => { return new Promise((resolve, reject) => {
      var buf = Buffer.from('i2cMessage');
      bus.i2cWrite(SLAVE_ADDR, buf.length, buf, (err, data) => err ? reject(err) : resolve);
    })})
  .then(() => { return new Promise((resolve, reject) => {
      bus.close((err, data) => err ? reject(err) : resolve() );
    })})
  .catch(reason => { throw reason; })

})();

