var c = {
	folder: 'ToCache',
	expireTime: 43200, // half a day (in seconds)
	debug: false, // does console.log debug
	remoteBackup: true // do you want the file(s) to be backed up to a remote cloud, like iCloud on iOS? Doesn't work on Android
};

var fileList = Ti.App.Properties.getList('To.ImageCache.ImageList',[]);

/**
 * Set the config
 * @param {Object} Config Object as per spec
 */
var config = function(config){
	if (!config){
		return;
	}
	if (config.debug){
		Ti.API.info('TIC - setting config');
	}
	_.each(c, function(value, key){
		if (config.hasOwnProperty(key)){
			c[key] = value;
			Ti.API.info('TIC - setting ' + key + ' to ' + value);
		};
	});
};

/**
 * Check if file based on filename is already in system
 */
var hasFile = function(filename){
	if (c.debug){
		Ti.API.info('TIC - checking file in system - ' + filename);
	}
	return _.findWhere(fileList, {filename: filename});
};

/**
 * has the directory been created yet?
 */
var checkDir = function(){
	var dir = Titanium.Filesystem.getFile(Titanium.Filesystem.applicationDataDirectory,c.folder);
	if (!dir.exists()){
		dir.createDirectory();
	}
	return true;
};

/**
 * how big is the cache? This function will return total cache in bytes
 */
var cacheSize = function(){
	var bytes = 0;
	if (c.debug)
		Ti.API.info('TIC - calculating cache size');
	
	_.each(fileList, function(file){
		bytes += file.fileSize;
	});
	
	return bytes;
};

/**
 * Clear the cache entirely
 */
var clearCache = function(){
	if (c.debug)
		Ti.API.info('TIC - Completely emtying cache');
		
	_.each(fileList, function(file){
		removeFile(file.filename);
	});
};

/**
 * Clear only cache files that are older than cache expiry time
 */
var flushExpired = function(){
	if (c.debug)
		Ti.API.info('TIC - flush expired files');

	var removeFiles = [];
	_.each(fileList, function(file){
		if (Date.now() - (file.added + (file.expireTime * 1000)) > 0){
			
			if (c.debug)
				Ti.API.info('TIC - found expired file, removing');
			
			removeFiles.push(file.filename);
		}
	});
	
	_.each(removeFiles, removeFile);
};

/**
 * Remove a file based on internal filename
 * Note: filename is generated by To.ImageCache
 * @param {String} Filename of the image
 */
var removeFile = function(filename){
	if (c.debug)
		Ti.API.info('TIC - removing file ' + filename);
		
	var file = hasFile(filename);
	if (!file){
		return false;
	}
	
	var path = Ti.Filesystem.applicationDataDirectory + file.folder;
	var f = Ti.Filesystem.getFile(path, file.filename);
	
	if (!f.exists()){
		fileList = _.without(fileList, file);
		Ti.App.Properties.setList('To.ImageCache.ImageList', fileList);
		if (c.debug)
			Ti.API.info('TIC - file has aleady been removed');
		
		return false;
	}
	
	if (f.deleteFile()){
		if (c.debug)
			Ti.API.info('TIC - file has been removed');
		fileList = _.without(fileList, file);
		Ti.App.Properties.setList('To.ImageCache.ImageList', fileList);
	}
};

function md5FileName(url){
	var filename = Ti.Utils.md5HexDigest(url);
	return filename;
}

/**
 * Remove a file based on URL from cache.
 * Useful if you don't know the filename
 * @param {String} URL of the image
 */
var removeRemote = function(url){
	if (c.debug)
		Ti.API.info('TIC - removing file based on URL');

	var filename = md5FileName(url);
	removeFile(filename);
};

/**
 * Store the file
 * @param {String} filename (needs to be unique, otherwise will overwrite)
 * @param {Blob} Blob of the image
 */
var storeFile = function(filename, blob){
	if (c.debug){
		Ti.API.info('TIC - store file ' + filename);
	}
	// check if directory has been created
	checkDir();
	
	// we already have this file
	if (hasFile(filename)){
		blob = null;
		return;
	}
	
	var path = Ti.Filesystem.applicationDataDirectory + c.folder;
	var file = Ti.Filesystem.getFile(path, filename);
	
	if (OS_IOS && c.hasOwnProperty(remoteBackup)){
		file.remoteBackup = c.remoteBackup;
	}
	
	file.write(blob);
	// destroy file after it has been saved
	file = null;
	
	fileList.push({
		filename: filename,
		added: Date.now(),
		fileSize: blob.length,
		expireTime: c.expireTime,
		folder: c.folder
	});
	
	// add file to collection
	Ti.App.Properties.setList('To.ImageCache.ImageList', fileList);
	
	// destroy blob
	blob = null;
};

/**
 * read file from memory
 */
var readFile = function(filename){
	if (c.debug){
		Ti.API.info('TIC - reading file from system ' + filename);
	}
	var file = hasFile(filename);
	
	var path = Ti.Filesystem.applicationDataDirectory + file.folder;
	var file = Ti.Filesystem.getFile(path, filename);
	return file.read();
};

/**
 * this function will always return a blob, wether it was cached or not
 * in case it wasn't cached, it will do so after first fetching it.
 * in case it was cached, it will just read the file and return the blob
 * Therefore, only use this function if you want to cache it. 
 * @param {String} url
 */
var remoteImage = function(url){
	if (c.debug){
		Ti.API.info('TIC - *************');
		Ti.API.info('remote image');
	}
	// calculate local filename
	var filename = md5FileName(url);
	Ti.API.info(filename);
	
	if (hasFile(filename)){
		if (c.debug){
			Ti.API.info('TIC - has file in system');
			Ti.API.info('TIC - *************');
		}
		
		// get file
		return readFile(filename);
	}
	Ti.API.info('TIC - doesn\'t have file yet');
	
	// generate a blob
	var image = Ti.UI.createImageView({
		image : url,
		width : Ti.UI.SIZE,
		height : Ti.UI.SIZE
	});
	var blob =  image.toBlob();
	image = null;
	
	storeFile(filename, blob);
	
	Ti.API.info('TIC - *************');
	return blob;
};

/**
 * This function will fetch the image in the background
 * with a configurable cache period
 * @param {String} url of the image to cache
 * @param {Integer} (Optional) Timeout in milliseconds
 * @param {Function} (Optional) callback function, blob will be returned
 */
var cache = function(url, timeout, cb){
	var timeout = timeout || 30000;

	// if file is already cached, don't do so again
	var filename = md5FileName(url);
	if (hasFile(filename)){
		if (c.debug)
			Ti.API.info('TIC - file already cached');
			
		return false;
	}
		
	var xhr = Titanium.Network.createHTTPClient({
		onload: function() {
			storeFile(filename, this.responseData);
			cb && cb(readFile(filename));
		},
		timeout: timeout
	});
	xhr.open('GET', url);
	xhr.send();
	return true;
};

/**
 * only export what is needed externally
 */
module.exports = {
	config: config,
	cacheSize: cacheSize,
	flushExpired: flushExpired,
	clearCache: clearCache,
	removeFile: removeFile,
	removeRemote: removeRemote,
	remoteImage: remoteImage,
	cache: cache
};
