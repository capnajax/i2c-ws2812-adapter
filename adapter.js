'use strict';

import i2c from 'i2c-bus';

const SLAVE_ADDR = 0x0B;

var bus;

(function () {

  Promise.resolve()
  .then(() => { return new Promise((resolve, reject) => {
      bus = i2c.open(1, (err, data) => err ? reject({err, data}) : resolve());
    })})
  .then(() => { return new Promise((resolve, reject) => {
      var buf = Buffer.from('i2cMessage');
      bus.i2cWrite(SLAVE_ADDR, buf.length, buf, (err, data) => err ? reject({err, data}) : resolve);
    })})
  .then(() => { return new Promise((resolve, reject) => {
      bus.close((err, data) => err ? reject({err, data}) : resolve() );
    })})
  .catch(reason => { throw reason; })

})();
