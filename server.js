var express = require('express');
var bodyParser = require('body-parser');
var mongo = require('mongodb').MongoClient;
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var geoip = require('geoip-lite');
var db;
var playlistController = {};
var playlistClients = {};
var latestVersion = {};

app.set('port', process.env.PORT || 8080);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use('/dist', express.static(__dirname + '/dist'));
app.use('/components', express.static(__dirname + '/components'));

// development only
// if ('development' == app.get('env')) {
//   console.log('Development mode.');

//   app.use(function(req, res, next){
//     //console.log('%s %s', req.method, req.url);
//     next();
//   });
// }

app.post('/p', function(req, res){
  var ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

  if(req.body.id){
    // update - just overwrite for now
    playlistController.update(req.body.id, req.body, res.send.bind(res));
  } else {
    // insert new record
    var data = req.body;
    data.ip = ip;
    playlistController.insert(data, res.send.bind(res));
  }
});

app.get('/p', function(req, res){
  playlistController.get(req.query.id, res.send.bind(res));
});

app.get('*', function(req, res){
  res.sendFile(__dirname + "/index.html");
});

// db - Mongo Connect
mongo.connect("mongodb://localhost/greatdj", function(err, database) {
  db = database;
  http.listen(app.get('port'), function(){
    console.log('Express server listening on port ' + app.get('port'));
  });
});

// socket io for realtime updates on playlists across clients
io.on('connection', function(socket){
  // socket is the client socket
  // global vars that belong to each socket
  var plId;

  console.log(' * new connection');

  socket.on('register', function(data){
    console.log(' * client connected', data.id);

    playlistClients[data.id] = playlistClients[data.id] || [];
    playlistClients[data.id].push(socket);
    plId = data.id;

    if(playlistClients[data.id].length > 1 && latestVersion[data.id]){
      socket.emit('playlistChange', latestVersion[data.id]);
    } else {
      playlistController.get(data.id, function(data){
        socket.emit('playlistChange', data);
      });
    }

  });

  socket.on('disconnect', function(){
    console.log(' * client disconnected', plId);
    //remove from playlistClients playlistClients
    if(plId){
      for (var i = playlistClients[plId].length - 1; i >= 0; i--) {
        if(playlistClients[plId][i] === socket){
          playlistClients[plId].splice(i, 1);
          return;
        }
      }

      if(!playlistClients[plId].length){
        latestVersion[plId] = null;
      }

      plId = null;

    }
  });

  socket.on('unregister', function(){
    console.log(' * client unregister', plId);
    //remove from playlistClients playlistClients
    if(plId){
      for (var i = playlistClients[plId].length - 1; i >= 0; i--) {
        if(playlistClients[plId][i] === socket){
          playlistClients[plId].splice(i, 1);
          return;
        }
      }
      plId = null;
    }
  });

  socket.on('changedPlaylist', function(data){
    console.log(' * changedPlaylist:', data.id);

    latestVersion[data.id] = data;

    for (var i = playlistClients[data.id].length - 1; i >= 0; i--) {
      var subscriber = playlistClients[data.id][i];
      if(subscriber !== socket){
        subscriber.emit('playlistChange', data);
      }
    }
  });

});

// playlist controllers controllers - get them out of here some day
playlistController.insert = function(data, callback){
  var id = Math.random().toString(36).slice(3,9); // revisit
  var geo = geoip.lookup(data.ip);

  var doc = {id: id, playlist: data.playlist, ip: data.ip, geo: geo, created: new Date()};

  db.collection('playlists').insert(doc, {w:1}, function(err, result) {
    console.log('insert ok ', id);
    callback({operation: 'insert', id: id});
  });
};

playlistController.update = function(id, data, callback){
  db.collection('playlists').update({id: id}, {$set:{playlist: data.playlist}}, {w:1}, function(err, result) {
    console.log('update ok ', id);
    callback({operation: 'update', id: id});
  });
};

playlistController.get = function(id, callback){
  db.collection('playlists').findOne({id: id}, function(err, item) {
    callback(item);
  });
};

