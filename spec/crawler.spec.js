var Crawler = require('../crawler');
var _ = require('underscore');

function getRecordedCallArguments(spyObj, methodName) {
  return spyObj[methodName].calls.all().map(function(call) {
    return call.args;
  });
}

describe('crawler', function() {

  var crawler;

  beforeEach(function() {
    crawler = new Crawler();
    crawler.configure();
  });

  describe('html comments', function() {

    it('should strip when present', function() {
      expect(crawler._stripComments(
        '<html><!--comment1--><body><!--comment2--></body></html>'
      )).toBe(
        '<html><body></body></html>'
      );
    });

    it('should make no changes to html with no comments', function() {
      expect(crawler._stripComments(
        '<div id="someDiv"></div>'
      )).toBe(
        '<div id="someDiv"></div>'
      );
    });
  });

  describe('getting urls from fragment', function() {

    var baseUrl = 'http://localhost:8080/basePath';

    it('should get a relative url from fragment', function() {
      expect(crawler._getAllUrls(baseUrl, '<a href="somePath/resource1"></a>'))
        .toEqual(['http://localhost:8080/somePath/resource1']);
    });

    it('should get several urls from fragment', function() {
      var fragment = '\
Link a\
<a href="a"></a>\
Link b\
<a href="b"></a>\
Link c\
<a href="c"></a>\
';

      expect(crawler._getAllUrls(baseUrl, fragment))
        .toEqual([
          'http://localhost:8080/a',
          'http://localhost:8080/b',
          'http://localhost:8080/c'
        ]);
    });

    it('should get absolute url from fragment', function() {
      expect(crawler._getAllUrls(baseUrl, '<a href="http://someotherhost/resource"></a>'))
        .toEqual(['http://someotherhost/resource']);
    });

    describe('ignoreRelative option', function() {

      describe('enabled', function() {

        beforeEach(function() {
          crawler.configure({
            ignoreRelative: true
          });
        });

        it('should ignore relative urls', function() {
          expect(crawler._getAllUrls(baseUrl, '<a href="/resource"></a>'))
            .toEqual([]);
        });

        it('should not ignore absolute urls', function() {
          expect(crawler._getAllUrls(baseUrl, '<a href="http://localhost/resource"></a>'))
            .toEqual(['http://localhost/resource']);
        });
      });

      describe('disabled', function() {

        beforeEach(function() {
          crawler.configure({
            ignoreRelative: false
          });
        });

        it('should not ignore relative urls', function() {
          expect(crawler._getAllUrls(baseUrl, '<a href="/resource"></a>'))
            .toEqual(['http://localhost:8080/resource']);
        });

        it('should not ignore absolute urls', function() {
          expect(crawler._getAllUrls(baseUrl, '<a href="http://localhost/resource"></a>'))
            .toEqual(['http://localhost/resource']);
        });
      });
    });

    it('should ignore links in the comments', function() {
      expect(crawler._getAllUrls(baseUrl, '<!--<a href="http://localhost/resource"></a>-->'))
        .toEqual([]);
    });

    describe('shouldCrawl option', function() {

      it('should filter urls based on shouldCrawl', function() {
        crawler.configure({
          shouldCrawl: function isOddResource(url) {
            var resourceId = parseInt(url.substring(url.lastIndexOf('/') + 1));

            return resourceId % 2 === 0;
          }
        });

        var fragment = '<a href="/resource/1"></a>\
<a href="/resource/2"></a>\
<a href="/resource/3"></a>\
<a href="/resource/4"></a>\
<a href="/resource/5"></a>\
';

        expect(crawler._getAllUrls(baseUrl, fragment))
          .toEqual([
            'http://localhost:8080/resource/2',
            'http://localhost:8080/resource/4'
          ]);
      });

      it('should crawl everything if shouldCrawl is not a function', function() {
        crawler.configure({
          shouldCrawl: false
        });

        var fragment = '<a href="/resource/1"></a>';

        expect(crawler._getAllUrls(baseUrl, fragment))
          .toEqual(['http://localhost:8080/resource/1']);
      });
    });
  });

  describe('crawl all urls', function() {

    var referer = 'referer';
    var depth = 1;

    it('should crawl all provided urls', function() {
      spyOn(crawler, '_crawlUrl');
      var urls = ['url1', 'url2', 'url3'];

      crawler._crawlUrls(urls, referer, depth);

      expect(getRecordedCallArguments(crawler, '_crawlUrl')).toEqual([
        ['url1', referer, depth],
        ['url2', referer, depth],
        ['url3', referer, depth]
      ]);
    });
  });

  describe('crawl url', function() {

    var referer = 'someReferrer';
    var url = 'someUrl';
    var userAgent = 'crawler/js-crawler';

    beforeEach(function() {
      spyOn(crawler, '_requestUrl');
    });

    it('should not crawl already known url again', function() {
      crawler.knownUrls[url] = true;

      crawler._crawlUrl(url, referer, 1);

      expect(crawler._currentUrlsToCrawl.length).toEqual(0);
      expect(crawler._requestUrl).not.toHaveBeenCalled();
    });

    it('should not crawl if reached maximum depth', function() {
      crawler._crawlUrl(url, referer, 0);

      expect(crawler._currentUrlsToCrawl.length).toEqual(0);
      expect(crawler._requestUrl).not.toHaveBeenCalled();
    });

    it('should request url with correct options', function() {
      var expectedOptions = {
        url: url,
        encoding: null,
        rejectUnauthorized : false,
        headers: {
          'User-Agent': userAgent,
          'Referer': referer
        }
      };

      crawler._crawlUrl(url, referer, 1);

      expect(crawler._requestUrl).toHaveBeenCalledWith(expectedOptions, jasmine.any(Function));
    });

    describe('received response', function() {

      var depth = 5;
      var error = 'someError';
      var errorStatusCode = 404;
      var errorResponse = {
        statusCode: errorStatusCode
      };
      var errorBody = 'Server error';

      describe('error', function() {

        beforeEach(function() {
          spyOn(crawler, 'onFailure');
          spyOn(crawler, '_finishedCrawling');
          crawler._requestUrl.and.callFake(function(options, callback) {
            callback(error, errorResponse, errorBody);
          });
          crawler._crawlUrl(url, referer, depth);
        });

        it('should handle error', function() {
          expect(crawler.onFailure).toHaveBeenCalledWith({
            url: url,
            status: errorStatusCode,
            error: error,
            response: errorResponse,
            body: errorBody
          });
        });

        it('should clean up internal fields keeing number of concurrent requests and urls to crawl', function() {
          crawler._requestUrl.and.callFake(function(options, callback) {
            expect(crawler._currentUrlsToCrawl).toEqual([url]);
            callback(error, errorResponse, errorBody);
            expect(crawler._currentUrlsToCrawl).toEqual([]);
            expect(crawler._concurrentRequestNumber).toEqual(0);
          });
          crawler._crawlUrl(url, referer, depth);
        });
      });

      describe('crawling is successful', function() {
        var OK = 200;
        var response = null;
        var body = 'Some next urls\
<a href="url1"></a>\
<a href="url2"></a>\
<a href="url3"></a>';

        beforeEach(function() {
          response = {
            statusCode: OK,
            headers: {
              'content-type': ''
            },
            request: {
              uri: {
                href: url
              }
            }
          };
          spyOn(crawler, 'onSuccess');
          crawler._requestUrl.and.callFake(function(options, callback) {
            callback(null, response, body);
          });
          spyOn(crawler, '_crawlUrls');
        });

        it('should call onSuccess', function() {
          crawler._crawlUrl(url, referer, depth);
          expect(crawler.onSuccess).toHaveBeenCalledWith({
            url: url,
            status: OK,
            content: body,
            error: null,
            response: response,
            body: body
          });
        });

        it('should add url to the list of known urls', function() {
          expect(crawler.crawledUrls).toEqual([]);
          crawler._crawlUrl(url, referer, depth);
          expect(crawler.crawledUrls).toEqual([url]);
        });

        describe('content type', function() {

          it('should crawl urls from the body if text/html', function() {
            response.headers['content-type'] = 'text/html';
            crawler._crawlUrl(url, referer, depth);
            expect(crawler._crawlUrls).toHaveBeenCalledWith(['url1', 'url2', 'url3'], url, depth - 1);
          });

          it('should stop crawling if binary', function() {
            response.headers['content-type'] = 'application/javascript';
            crawler._crawlUrl(url, referer, depth);
            expect(crawler._crawlUrls).not.toHaveBeenCalled();
          });

          it('should not crawl further if minimum depth reached', function() {
            response.headers['content-type'] = 'text/html';
            crawler._crawlUrl(url, referer, 1);
            expect(crawler._crawlUrls).not.toHaveBeenCalled();
          });
        });

        describe('content encoding', function() {

          var decodedBody = 'Decoded body';

          beforeEach(function() {
            response.headers['content-type'] = 'text/html';
            body = jasmine.createSpyObj('bodyBuffer', ['toString']);
            body.toString.and.returnValue(decodedBody);
          });

          it('if no header provided, utf8 is used by default', function() {
            crawler._crawlUrl(url, referer, depth);
            expect(body.toString).toHaveBeenCalledWith('utf8');
          });

          it('if header provided, it is used', function() {
            response.headers['content-encoding'] = 'gzip';
            crawler._crawlUrl(url, referer, depth);
            expect(body.toString).toHaveBeenCalledWith('gzip');
          });
        });

        it('records all redirects that happened as known urls', function() {
          crawler._requestUrl.and.callFake(function(options, callback) {
            var context = {
              redirects: [
                {redirectUri: 'redirect1'},
                {redirectUri: 'redirect2'},
                {redirectUri: 'redirect3'}
              ]
            };
            callback.call(context, null, response, body);
          });
          crawler._crawlUrl(url, referer, depth);
          expect(_.chain(crawler.knownUrls).keys().sort().value()).toEqual(['redirect1', 'redirect2', 'redirect3', 'someUrl']);
        });
      });
    });
  });

  describe('forget crawled', function() {

    it('should forget crawled and known urls', function() {
      crawler.knownUrls = {
        'url1': true,
        'url2': true,
        'url3': true
      };
      crawler.crawledUrls = ['url1', 'url2', 'url3'];
      crawler.forgetCrawled();
      expect(crawler.knownUrls).toEqual({});
      expect(crawler.crawledUrls).toEqual([]);
    });
  });

  describe('started/finished crawling', function() {

    it('should remember the url being crawled', function() {
      crawler._startedCrawling('url1');
      expect(crawler._currentUrlsToCrawl).toEqual(['url1']);
    });

    it('should remove url from the list of urls being crawled', function() {
      crawler._startedCrawling('url1');
      crawler._startedCrawling('url2');
      crawler._startedCrawling('url3');
      crawler._finishedCrawling('url2');
      expect(crawler._currentUrlsToCrawl).toEqual(['url1', 'url3']);
    });

    describe('all crawling finished', function() {

      beforeEach(function() {
        spyOn(crawler, 'onAllFinished');
        crawler._startedCrawling('url1');
        crawler.crawledUrls = ['url1'];
        crawler.workExecutor = jasmine.createSpyObj('workExecutor', ['stop']);
        crawler._finishedCrawling('url1');
      });

      it('should call onFinished with list of known urls', function() {
        expect(crawler.onAllFinished).toHaveBeenCalledWith(['url1']);
      });

      it('should stop work executor', function() {
        expect(crawler.workExecutor.stop).toHaveBeenCalled();
      });
    });
  });

  describe('_requestUrl', function() {

    var url = 'url';

    beforeEach(function() {
      crawler.workExecutor = jasmine.createSpyObj('workExecutor', ['submit']);
      spyOn(crawler, '_startedCrawling');
      spyOn(crawler, '_finishedCrawling');
    });

    describe('shouldSkip argument', function() {

      it('should skip known url', function() {
        crawler.workExecutor.submit.and.callFake(function(func, context, args, shouldSkip) {
          crawler.knownUrls = [url];
          expect(shouldSkip(url)).toBe(true);
        });
        crawler._requestUrl({
          url: url
        });
      });

      it('should skip url if test function says so', function() {
        spyOn(crawler, 'shouldCrawl');
        crawler.shouldCrawl.and.returnValue(false);
        crawler.workExecutor.submit.and.callFake(function(func, context, args, shouldSkip) {
          expect(shouldSkip(url)).toBe(true);
        });
        crawler._requestUrl({
          url: url
        });
      });
    });

    describe('func argument', function() {

      var options = 'func options';
      var callback = _.noop;
      var error = null;
      var response = 'response';
      var body = 'response body';

      it('should increment and decrement concurrent request number, call on started and finished', function() {
        crawler.workExecutor.submit.and.callFake(function(func, context, args, shouldSkip) {
          func(options, callback);
          crawler.request = function(options, callback) {
            expect(crawler._startedCrawling).toHaveBeenCalledWith(url);
            expect(crawler._concurrentRequestNumber).toBe(1);
            //Callback code should call _finishedCrawling and decrement the counter of concurrent requests
            callback(error, response, body);
            expect(crawler._finishedCrawling).toHaveBeenCalledWith(url);
            expect(crawler._concurrentRequestNumber).toBe(0);
          };
        });
        crawler._requestUrl({
          url: url
        });
      });
    });
  });
});