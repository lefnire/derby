var fs = require('fs')
  , path = require('path')
  , http = require('http')
  , racer = require('racer')
  , tracks = require('tracks')
  , View = require('./View.server')
  , sharedCreateApp = require('./app').create
  , autoRefresh = require('./refresh.server').autoRefresh
  , derbyCluster = require('./cluster')
  , viewModel = require('./viewModel')
  , util = racer.util
  , merge = util.merge
  , isProduction = util.isProduction
  , proto

module.exports = derbyServer;

function derbyServer(derby) {
  derby.run = run;
  derby.createApp = createApp;
  derby.createStatic = createStatic;

  Object.defineProperty(derby, 'version', {
    get: function() {
      return require('../package.json').version;
    }
  });
}
derbyServer.decorate = 'derby';
derbyServer.useWith = {server: true, browser: false};

function run(filename, port) {
  // Resolve relative filenames
  filename = path.resolve(filename);
  if (port == null) port = process.env.PORT || (isProduction ? 80 : 3000);
  derbyCluster.run(filename, port)
}

function createApp(appModule) {
  var app = sharedCreateApp(this, appModule)
    , view = app.view

  racer.on('createStore', function(store) {
    autoRefresh(store, view, isProduction);
  });

  // Expose methods on the application module

  function Page(model, res) {
    this.model = model;
    this.view = view;
    this._res = res;
    this._viewModels = [];
  }
  Page.prototype.render = function(ns, ctx, status) {
    this._res._derbyViewModels = this._viewModels;
    view.render(this._res, this.model, ns, ctx, status);
  };
  Page.prototype.init = viewModel.pageInit;

  function createPage(req, res) {
    var model = req.getModel();
    return new Page(model, res);
  }
  function onRoute(callback, page, params, next, isTransitional) {
    if (isTransitional) {
      callback(page.model, params, next);
    } else {
      callback(page, page.model, params, next);
    }
  }
  app.routes = tracks.setup(app, createPage, onRoute);

  app.ready = function() {};
  app.render = function(res, model, ns, ctx, status) {
    return view.render(res, model, ns, ctx, status);
  };

  // Render immediately upon creating the app so that files
  // will be cached for the first render and the appHash gets
  // computed for reconnecting windows
  process.nextTick(function() {
    view.render();
  });
  return app;
}

function createStatic(root) {
  return new Static(root, this._libraries);
}

function Static(root, libraries) {
  this.root = root;
  this.libraries = libraries;

  // Allow clients to define view functions
  this.view = {
    _instances:{},
    fnDefs: {},
    fn: function (name, value) {
      this.fnDefs[name] = value;

      // Add the function to any existing cached view instances
      for (var viewKey in this._instances) {
        if (this._instances.hasOwnProperty(viewKey))
          this._instances[viewKey].fn(name, value);
      }
    }
  };
}
Static.prototype.getView = function (name) {
  var view = this.view._instances[name];
  if (view) 
    return view;

  view = this.view._instances[name] = new View(this.libraries);
  view._root = this.root;
  view._clientName = name;

  for (var key in this.view.fnDefs) {
    if (this.view.fnDefs.hasOwnProperty(key))
      view.fn(key, this.view.fnDefs[key]);
  }
  return view;
};
Static.prototype.render = function (name, res, model, ns, ctx, status) {
  this.getView(name).render(res, model, ns, ctx, status, true);
};
Static.prototype.pack = function (name, cb) {
  this.getView(name).pack(true, cb);
};
