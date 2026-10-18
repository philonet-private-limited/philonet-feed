// SPDX-License-Identifier: Apache-2.0
module.exports = {
  scoring: { config: require('./scoring/config'), score: require('./scoring/score'), affinity: require('./scoring/affinity') },
  assembly: { page: require('./assembly/page'), layout: require('./assembly/layout'), collapse: require('./assembly/collapse'), config: require('./assembly/config') },
  ledger: require('./ledger'),
  seen: require('./seen'),
  activity: require('./activity'),
  milestones: require('./milestones'),
  reactions: require('./reactions'),
};
