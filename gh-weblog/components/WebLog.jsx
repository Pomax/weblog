var WebLog = React.createClass({

  mixins: [
    ConnectorMixin,
    TimeToId,
    RSSGenerator
  ],

  // local cache, because we don't want to load the entire
  // index at once, and we don't want to requery for it.
  index: [],

  // local cache, because we can't be sure state won't
  // be modified multiple times per time slice.
  list: {},

  getInitialState: function() {
    return {
      singleton: false,
      entries: this.list,
      slice: { start: 0, end: 10 },
      githubissues: '',
      authenticated: false,
      site: '',
      issues: ''
    };
  },

  componentDidMount: function() {
    // are we authenticataed?
    var settings = localStorage["gh-weblog-settings"];
    if(settings) {
      settings = JSON.parse(settings);
      this.connector = new this.Connector(settings);
      if(settings.token) { this.setState({ authenticated: true }); }
    } else { this.connector = new this.Connector(); }

    // are we loading one entry, or "all" entries?
    var fragmentId = window.location.hash || false;
    if(fragmentId) {
      if(fragmentId.indexOf("#gh-weblog")>-1) {
        fragmentId = fragmentId.replace("#gh-weblog-",'');
      } else { fragmentId = false; }
    }
    var id = this.timeToId(fragmentId);
    if(id) { this.setState({ singleton: true }); }

    // load the necessary index information
    this.connector.loadIndex(this.loadIndex, id);

    // determine the issue tracker to use:
    var a = document.createElement("a");
    a.href = this.props.base;
    var user = a.host.replace(".github.io",'');
    var path = a.pathname.replace(/^\//,'').trim().split('/')[0];
    var repo = path ? path : a.host;
    this.setState({
      site: "http://github.com/" + user + "/" + repo,
      issues: "http://github.com/" + user + "/" + repo + "/issues"
    });
  },

  render: function() {
    var postbutton,
        morebutton,
        adminbutton;

    if(!this.state.singleton) {
      adminbutton = <button className="authenticate" onClick={this.showSettings} onClose={this.bindSettings}>admin</button>
      if(this.state.authenticated) { postbutton = <button className="admin post button" onClick={this.create}>new entry</button>; }
      morebutton = <button onClick={this.more}>Load more posts</button>;
    }

    return (
      <div ref="weblog" className="gh-weblog">
        <Admin ref="admin" hidden="true" onClose={this.bindSettings} onLogout={this.onLogOut}/>
        {adminbutton}
        {postbutton}
        {this.generateEntries()}
        {morebutton}
      </div>
    );
  },

  generateEntries: function() {
    var self = this;
    return this.getSlice().map(function(entry) {
      return <Entry key={entry.metadata.created}
                    ref={entry.metadata.id}
                    issues={self.state.issues}
                    metadata={entry.metadata}
                    postdata={entry.postdata}
                    editable={!self.state.singleton && self.state.authenticated}
                    runProcessors={self.runProcessors}
                    onSave={self.save}
                    onDelete={self.delete}/>;
    });
  },

  runProcessors: function(domnode) {
    if(this.props.processors && this.props.processors instanceof Array) {
      this.props.processors.forEach(function(process) {
        process(domnode);
      });
    }
  },

  showSettings: function() {
    this.refs.admin.show();
  },

  bindSettings: function(settings) {
    this.connector.setProperties(settings);
    if(settings.token.trim()) {
      this.setState({ authenticated: true });
    }
  },

  onLogOut: function() {
    this.setState({ authenticated: false });
  },

  more: function() {
    this.setState({
      slice: {
        start: this.state.slice.start,
        end: this.state.slice.end + 10
      }
    }, this.loadEntries);
  },

  getSlice: function() {
    var list = this.list;
    var start = this.state.slice.start;
    var end = this.state.slice.end;
    var ids = Object.keys(list).sort().reverse().slice(start, end);
    return ids.map(function(id) { return list[id]; });
  },

  loadIndex: function(err, index) {
    // latest entry on top
    this.index = index.reverse();
    this.loadEntries();
  },

  loadEntries: function() {
    var connector = this.connector;
    var setEntry = this.setEntry;
    // find load slice
    var start = this.state.slice.start;
    var end = this.state.slice.end;
    var slice = this.index.slice(start, end);
    var cache = this.list;
    // run through all
    (function next(list) {
      if(list.length===0) return;
      var id = list.splice(0,1)[0];
      if(cache[id]) return next(list);
      connector.loadMetadata(id, function(err, metadata) {
        if(err) {
          console.error("no metadata found for id: "+id+" ("+err+")");
          next(list);
          return;
        }
        connector.loadEntry(id, function(err, postdata) {
          if(err) {
            console.error("no post data found for id: "+id+" ("+err+")");
            next(list);
            return;
          }
          setEntry(id, metadata, postdata);
          next(list);
        });
      });
    }(slice));
  },

  setEntry: function(id, metadata, postdata) {
    metadata.id = id;
    if(this.index.indexOf(id)===-1) {
      this.index.push(id);
    }
    this.list[id] = {
      metadata: metadata,
      postdata: postdata
    };
    this.setState({ entries: this.list });
  },

  create: function() {
    var date = new Date();
    var timestamp = date.getTime();
    var metadata = {
      title: "New Entry",
      created: timestamp,
      published: timestamp, // we can turn this into -1 for drafts
      updated: timestamp,
      tags: []
    };
    var postdata = "...click here to start editing your post...";
    var id = this.timeToId(timestamp);
    this.setEntry(id, metadata, postdata);
  },

  save: function(entry) {
    var self = this;
    this.setEntry(entry.state.id, entry.getMetaData(), entry.postdata);
    this.connector.saveEntry(entry, this.index, function saved() {
      console.log("save handled");
      self.saveRSS();
    });
  },

  delete: function(entry) {
    var confirmed = confirm("really delete post?");
    if(confirmed) {
      var self = this;
      var id = entry.state.id;
      // remove from index:
      var pos = this.index.indexOf(id);
      this.index.splice(pos,1);
      // remove from list of loaded entries:
      delete this.list[id];
      this.setState({ entries: this.list });
      this.connector.deleteEntry(entry, this.index, function deleted() {
        console.log("delete handled");
        self.saveRSS();
      });
    }
  },

  saveRSS: function() {
    var self = this;
    var connector = this.connector;
    console.log("Updating RSS...");
    connector.saveRSS(self.toRSS(), function() {
      console.log("updated.");
      if(self.props.rssfeeds) {
        console.log("Updating category-specific RSS...");
        var feeds = self.props.rssfeeds.split(",")
                                       .map(function(v) { return v.trim(); })
                                       .filter(function(v) { return !!v; });
        (function nextCategory() {
          if(feeds.length===0) return console.log("All RSS feeds updated");
          var category = feeds.splice(0,1)[0];
          console.log("Updating category "+category);
          connector.saveRSS(self.toRSS(category), category.toLowerCase(), nextCategory);
        }());
      }
    });
  }

});

