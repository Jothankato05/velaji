const { MongoMemoryServer } = require('mongodb-memory-server');
(async () => { const m = await MongoMemoryServer.create({ instance: { port: 27119, dbName: 'velaji' } }); console.log(m.getUri()); })();
