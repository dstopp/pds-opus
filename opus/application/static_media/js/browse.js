/* jshint esversion: 6 */
/* jshint bitwise: true, curly: true, freeze: true, futurehostile: true */
/* jshint latedef: true, leanswitch: true, noarg: true, nocomma: true */
/* jshint nonbsp: true, nonew: true */
/* jshint varstmt: true */
/* globals $, _, PerfectScrollbar */
/* globals o_cart, o_hash, o_menu, o_utils, opus */
/* globals DEFAULT_COLUMNS */

// font awesome icon class
const pillSortUpArrow = "fas fa-arrow-circle-up";
const pillSortDownArrow = "fas fa-arrow-circle-down";
const tableSortUpArrow = "fas fa-sort-up";
const tableSortDownArrow = "fas fa-sort-down";
const defaultTableSortArrow = "fas fa-sort";
const infiniteScrollUpThreshold = 100;
// Fixed scrollbar length for gallery & table view
const galleryAndTablePSLength = 100;

/* jshint varstmt: false */
var o_browse = {
/* jshint varstmt: true */
    selectedImageID: "",

    metadataSelectorDrawn: false,

    tableScrollbar: new PerfectScrollbar("#browse .op-data-table-view", {
        minScrollbarLength: galleryAndTablePSLength,
        maxScrollbarLength: galleryAndTablePSLength,
    }),
    galleryScrollbar: new PerfectScrollbar("#browse .op-gallery-view", {
        suppressScrollX: true,
        minScrollbarLength: galleryAndTablePSLength,
        maxScrollbarLength: galleryAndTablePSLength,
    }),
    modalScrollbar: new PerfectScrollbar("#galleryViewContents .metadata", {
        minScrollbarLength: opus.minimumPSLength
    }),

    galleryBegun: false, // have we started the gallery view
    galleryData: {},  // holds gallery column data
    imageSize: 100,     // default
    maxCachedObservations: 1000,    // max number of observations to store in cache;
                                    // at some point, we can probably figure this out dynamically

    galleryBoundingRect: {'x': 0, 'y': 0},
    gallerySliderStep: 10,

    currentOpusId: "",
    tempHash: "",
    onRenderData: false,
    fading: false,  // used to prevent additional clicks until the fade animation complete
    /**
    *
    *  all the things that happen on the browse tab
    *
    **/
    addBrowseBehaviors: function() {
        // note: using .on vs .click allows elements to be added dynamically w/out bind/rebind of handler

        $(".op-gallery-view, .op-data-table-view").on("scroll", o_browse.checkScroll);

        // Mouse wheel up will also trigger ps-scroll-up.
        // NOTE: We put both wheel and ps-scroll-up here for a corner case like this:
        // 1. Scroll slider to the very end (scrollbar will be at the bottom and is fairly long)
        // 2. When moving scrollbar around scroll threshold point at the bottom end, it will keep triggering
        //    infiniteScroll request and load with 0 returned data (We haven't found a proper way to avoid this yet, so for now we leave it like that).
        // 3. In above step, at the time when infiniteScroll request (we call it request A here) is triggered but before the load, if we move the scrollbar
        //    all the way up to the top in a very fast manner, the loadPrevPage will be triggered with url in request A. This means we will have 0 returned
        //    data prepended. So we do the followings to fix this issue:
        // - Prefetch more data ahead of startObs if the current (middle) page has reached to the bottom end of the data.
        // - Lower the scroll threshold point in infiniteScroll.
        // - Adding wheel event: because wheel event can (ps-scroll-up can't) trigger another loadNextPage with correct url if we reach to the top end
        //   in that corner case.
        $(".op-gallery-view, .op-data-table-view").on("wheel ps-scroll-up", function(event) {
            let startObsLabel = o_browse.getStartObsLabel();
            let tab = opus.getViewTab();
            let contentsView = o_browse.getScrollContainerClass();

            if (event.type === "ps-scroll-up" || (event.type === "wheel" && event.originalEvent.deltaY < 0)) {
                if (opus.prefs[startObsLabel] > 1) {
                    let firstObs = $(`${tab} [data-obs]`).first().data("obs");
                    if (firstObs !== undefined && firstObs !== 1 && $(`${tab} ${contentsView}`).scrollTop() < infiniteScrollUpThreshold) {
                        $(`${tab} ${contentsView}`).infiniteScroll({
                            "loadPrevPage": true,
                        });
                        $(`${tab} ${contentsView}`).infiniteScroll("loadNextPage");
                        o_browse.updateSliderHandle();
                    }
                }
            }
        });

        $("#op-metadata-selector").modal({
            keyboard: false,
            backdrop: 'static',
            show: false,
        });

        // browse nav menu - the gallery/table toggle
        $("#browse, #cart").on("click", ".op-browse-view", function() {
            if (o_browse.fading) {
                return false;
            }

            o_browse.hideMenu();
            let browse = o_browse.getBrowseView();
            opus.prefs[browse] = $(this).data("view");

            o_hash.updateHash();
            o_browse.updateBrowseNav();
            // reset scroll position
            window.scrollTo(0, 0); // restore previous scroll position

            // Do the fake API call to write in the Apache log files that
            // we changed views so log_analyzer has something to go on
            let hashString = o_hash.getHash();
            let fakeUrl = `/opus/__fake/__api/dataimages.json?${hashString}`;
            $.getJSON(fakeUrl, function(data) {
            });

            return false;
        });

        // browse nav menu - download csv
        $("#browse").on("click", ".op-download-csv", function() {
            let colStr = opus.prefs.cols.join(',');
            let selectionsHash = [];
            for (let param in opus.selections) {
                if (opus.selections[param].length) {
                    let valueStr = opus.selections[param].join(',').replace(/ /g,'+');
                    selectionsHash.push(`${param}=${valueStr}`);
                }
            }
            let selectionsHashStr = selectionsHash.join('&');
            if (selectionsHashStr !== "") {
                selectionsHashStr += "&";
            }
            let resultCountStr = opus.resultCount.toString();
            let orderStr = opus.prefs.order.join(",");
            let csvLink = `/opus/__api/data.csv?${selectionsHashStr}cols=${colStr}&limit=${resultCountStr}&order=${orderStr}`;
            $(this).attr("href", csvLink);
        });

        // 1 - click on thumbnail opens modal window
        // 2-  Shift+click or menu/"Start Add[Remove] Range Here" starts a range
        //          Shfit+click on menu/"End Add[Remove] Range Here" ends a range
        //          Clicking on a cart/trash can anywhere aborts the range selection
        // 3 - ctrl click - alternate way to add to cart
        // NOTE: range can go forward or backwards

        // images...
        $(".gallery").on("click", ".thumbnail", function(e) {
            // make sure selected modal thumb is unhighlighted, as clicking on this closes the modal
            // but is not caught in time before hidden.bs to get correct opusId
            e.preventDefault();
            o_browse.hideMenu();

            let opusId = $(this).parent().data("id");
            let startElem = $(e.delegateTarget).find(".op-selected");

            // Detecting ctrl (windows) / meta (mac) key.
            if (e.ctrlKey || e.metaKey) {
                o_cart.toggleInCart(opusId);
                o_browse.undoRangeSelect();
            }
            // Detecting shift key
            else if (e.shiftKey) {
                if (startElem.length == 0) {
                    o_browse.startRangeSelect(opusId);
                    //o_cart.toggleInCart(opusId);
                } else {
                    let fromOpusId = $(startElem).data("id");
                    o_cart.toggleInCart(fromOpusId, opusId);
                }
            } else {
                o_browse.showModal(opusId);
            }
        });

        // data_table - clicking a table row adds to cart
        $(".op-data-table").on("click", ":checkbox", function(e) {
            if ($(this).val() == "all") {
                // checkbox not currently implemented
                // pop up a warning if selection total is > 100 items,
                // with the total number to be selected...
                // if OK, use 'addall' api and loop tru all checkboxes to set them as selected
                //o_cart.editCart("all",action);
                return false;
            }
            let tab = opus.getViewTab();
            let opusId = $(this).val();
            let startElem = $(`${tab} .thumb.gallery`).find(".selected");

            if (e.shiftKey) {
                if (startElem.length == 0) {
                    o_browse.startRangeSelect(opusId);
                    //o_cart.toggleInCart(opusId);
                } else {
                    let fromOpusId = $(startElem).data("id");
                    o_cart.toggleInCart(fromOpusId, opusId);
                }
            } else {
                o_cart.toggleInCart(opusId);
                // single click stops range selection; shift click starts range
                o_browse.undoRangeSelect();
            }
        });

        $(".op-data-table").on("click", "td:not(:first-child)", function(e) {
            let opusId = $(this).parent().data("id");
            e.preventDefault();
            o_browse.hideMenu();

            let tab = opus.getViewTab();
            let startElem = $(`${tab} .thumb.gallery`).find(".selected");

            // Detecting ctrl (windows) / meta (mac) key.
            if (e.ctrlKey || e.metaKey) {
                o_cart.toggleInCart(opusId);
                o_browse.undoRangeSelect();
            }
            // Detecting shift key
            else if (e.shiftKey) {
                if (startElem.length == 0) {
                    o_browse.startRangeSelect(opusId);
                    //o_cart.toggleInCart(opusId);
                } else {
                    let fromOpusId = $(startElem).data("id");
                    o_cart.toggleInCart(fromOpusId, opusId);
                }
            } else {
                o_browse.showModal(opusId);
            }
        });

        // thumbnail overlay tools
        $('.gallery, .op-data-table').on("click", ".op-tools a", function(e) {
          //snipe the id off of the image..
          let opusId = $(this).parent().data("id");

          switch ($(this).data("icon")) {
              case "info":  // detail page
                  o_browse.hideMenu();
                  o_browse.showDetail(e, opusId);
                  break;

              case "cart":   // add to cart
                  o_browse.hideMenu();
                  // clicking on the cart/trash can aborts range select
                  o_browse.undoRangeSelect();

                  let action = o_cart.toggleInCart(opusId);
                  o_browse.updateCartIcon(opusId, action);
                  break;

              case "menu":  // expand, same as click on image
                  o_browse.showMenu(e, opusId);
                  break;
            }
            return false;
        }); // end click a browse tools icon

        $("#gallerylView").modal({
            keyboard: false,
            backdrop: 'static',
            show: false,
        });

        // do we need an on.resize for when the user makes the screen tiny?

        $(".modal-dialog").draggable({
            handle: ".modal-content",
            cancel: ".metadata",
            drag: function(event, ui) {
                o_browse.hideMenu();
            }
        });

        $(".app-body").on("hide.bs.modal", "#galleryView", function(e) {
            $(`#${opus.prefs.view}`).find(".modal-show").removeClass("modal-show");
        });

        $('#galleryView').on("click", "a.select", function(e) {
            let opusId = $(this).data("id");
            if (opusId) {
                // clicking on the cart/trash can aborts range select
                o_browse.undoRangeSelect();
                o_cart.toggleInCart(opusId);
            }
            return false;
        });

        $('#galleryView').on("click", "a.prev,a.next", function(e) {
            let action = $(this).hasClass("prev") ? "prev" : "next";
            let opusId = $(this).data("id");

            if (opusId) {
                if (action === "next") {
                    o_browse.loadNextPageIfNeeded(opusId);
                } else {
                    o_browse.loadPrevPageIfNeeded(opusId);
                }

                o_browse.updateGalleryView(opusId);
            }
            return false;
        });

        $("#galleryView").on("click", "a.menu", function(e) {
            let opusId = $(this).data("id");
            o_browse.showMenu(e, opusId);
            return false;
        });

        // click table column header to reorder by that column
        $("#browse, #cart").on("click", ".op-data-table-view th a",  function() {
            // show this spinner right away when table is clicked
            // we will hide page status loader from infiniteScroll if op-page-loading-status loader is spinning
            $(".op-page-loading-status > .loader").show();
            let orderBy =  $(this).data("slug");
            let targetSlug = orderBy;

            // get order of opusid when table header is clicked
            let hash = o_hash.getHashArray();
            let opusidOrder = (hash.order && hash.order.match(/(-?opusid)/)) ? hash.order.match(/(-?opusid)/)[0] : "opusid";
            let isDescending = true;
            let orderIndicator = $(this).find("span:last");
            let pillOrderIndicator = $(`.sort-contents span[data-slug="${orderBy}"] .flip-sort`);
            o_browse.galleryBegun = false;

            if (orderIndicator.data("sort") === "sort-asc") {
                // currently ascending, change to descending order
                orderBy = '-' + orderBy;
            } else if (orderIndicator.data("sort") === "sort-desc") {
                // currently descending, change to ascending order
                isDescending = false;
                orderBy = orderBy;
            } else {
                // not currently ordered, change to ascending
                isDescending = false;
            }

            // make sure opusid is always in order slug values
            opus.prefs.order = orderBy.match(/opusid/) ? [orderBy] : [orderBy, opusidOrder];
            o_browse.updateOrderIndicator(orderIndicator, pillOrderIndicator, isDescending, targetSlug);

            o_hash.updateHash();
            o_browse.renderSortedDataFromBeginning();

            return false;
        });

        // browse sort order - remove sort slug
        $(".sort-contents").on("click", "li .remove-sort", function() {
            $(".op-page-loading-status > .loader").show();
            let slug = $(this).parent().attr("data-slug");
            let descending = $(this).parent().attr("data-descending");
            o_browse.galleryBegun = false;

            if (descending == "true") {
                slug = "-"+slug;
            }
            let slugIndex = $.inArray(slug, opus.prefs.order);
            // The clicked-on slug should always be in the order list;
            // The "if" is a safety precaution and the condition should always be true
            if (slugIndex >= 0) {
                opus.prefs.order.splice(slugIndex, 1);
            }

            // remove the sort pill right away
            // NOTE: we will find a better way to do this using data-xxx in the future.
            $(this).closest(".list-inline-item").remove();

            o_hash.updateHash();
            // o_browse.updatePage();
            o_browse.renderSortedDataFromBeginning();
        });

        // browse sort order - flip sort order of a slug
        $(".sort-contents").on("click", "li .flip-sort", function() {
            $(".op-page-loading-status > .loader").show();
            let slug = $(this).parent().attr("data-slug");
            let targetSlug = slug;
            let isDescending = true;
            let descending = $(this).parent().attr("data-descending");
            let headerOrderIndicator = $(`.op-data-table-view th a[data-slug="${slug}"]`).find("span:last");
            let pillOrderIndicator = $(this);
            o_browse.galleryBegun = false;

            let new_slug = slug;
            if (descending == "true") {
                slug = "-"+slug; // Old descending, new ascending
                isDescending = false;
            } else {
                new_slug = "-"+slug; // Old ascending, new descending
                isDescending = true;
            }
            let slugIndex = $.inArray(slug, opus.prefs.order);
            // The clicked-on slug should always be in the order list;
            // The "if" is a safety precaution and the condition should always be true
            if (slugIndex >= 0) {
                opus.prefs.order[slugIndex] = new_slug;
            }

            // When clicking on opusid sorting pill AND there is another sort order other an opusid, we don't update the table header arrows
            // Only one arrow will displayed either up or down at a time, rest of arrows will be up + down in table header
            if (targetSlug === "opusid" && opus.prefs.order.length > 1) {
                o_browse.updateOrderIndicator(null, pillOrderIndicator, isDescending, targetSlug);
            } else {
                o_browse.updateOrderIndicator(headerOrderIndicator, pillOrderIndicator, isDescending, targetSlug);
            }

            // order in the url will get updated right away
            o_hash.updateHash();

            // o_browse.updatePage();
            o_browse.renderSortedDataFromBeginning();
        });

        $("#op-obs-menu").on("click", '.dropdown-header',  function(e) {
            o_browse.hideMenu();
            return false;
        });

        $("#op-obs-menu").on("click", '.dropdown-item',  function(e) {
            let opusId = $(this).parent().attr("data-id");
            o_browse.hideMenu();

            switch ($(this).data("action")) {
                case "cart":  // add/remove from cart
                    o_cart.toggleInCart(opusId);
                    // clicking on the cart/trash can aborts range select
                    o_browse.undoRangeSelect();
                    break;
                case "range": // begin/end range
                    let tab = opus.getViewTab();
                    let startElem = $(tab).find(".selected");
                    if (startElem.length == 0) {
                        o_browse.startRangeSelect(opusId);
                        //o_cart.toggleInCart(opusId);
                    } else {
                        let fromOpusId = $(startElem).data("id");
                        o_cart.toggleInCart(fromOpusId, opusId);
                    }
                    break;
                case "info":  // detail page
                    o_browse.showDetail(e, opusId);
                    break;
                case "downloadCSV":
                case "downloadCSVAll":
                case "downloadData":
                case "downloadURL":
                    document.location.href = $(this).attr("href");
                    break;
                case "help":
                    break;
            }
            return false;
        });

        $("#op-observation-slider").slider({
            animate: true,
            value: 1,
            min: 1,
            max: 1000,
            step: o_browse.gallerySliderStep,
            slide: function(event, ui) {
                o_browse.onUpdateSliderHandle(ui.value);
            },
            stop: function(event, ui) {
                o_browse.onUpdateSlider(ui.value);
            }
        });

        $(document).on("keydown click", function(e) {
            o_browse.hideMenu();

            if ((e.which || e.keyCode) == 27) { // esc - close modals
                $("#galleryView").modal('hide');
                $("#op-metadata-selector").modal('hide');
                // reset range select
                o_browse.undoRangeSelect();
            }
            if ($("#galleryView").hasClass("show")) {
                /*  Catch the right/left arrow while in the modal
                    Up: 38
                    Down: 40
                    Right: 39
                    Left: 37 */
                let opusId;

                // the || is for cross-browser support; firefox does not support keyCode
                switch (e.which || e.keyCode) {
                    case 39:  // next
                        opusId = $("#galleryView").find(".next").data("id");
                        o_browse.loadNextPageIfNeeded(opusId);
                        break;
                    case 37:  // prev
                        opusId = $("#galleryView").find(".prev").data("id");
                        o_browse.loadPrevPageIfNeeded(opusId);
                        break;
                }
                if (opusId && !$("#galleryViewContents").hasClass("op-disabled")) {
                    o_browse.updateGalleryView(opusId);
                }
            }
            // don't return false here or it will snatch all the user input!
        });
    }, // end browse behaviors

    // update order arrows right away when user clicks on sorting arrows in pill or table header
    // sync up arrows in both sorting pill and table header
    updateOrderIndicator: function(headerOrderIndicator, pillOrderIndicator, isDescending, slug) {
        let headerOrder = isDescending ? "sort-desc" : "sort-asc";
        let headerOrderArrow = isDescending ? tableSortUpArrow : tableSortDownArrow;
        let pillOrderTooltip = isDescending ? "Change to ascending sort" : "Change to descending sort";

        // If header already exists, we update the header arrow, else we do nothing
        if (headerOrderIndicator && headerOrderIndicator.length !== 0) {
            headerOrderIndicator.data("sort", `${headerOrder}`);
            headerOrderIndicator.attr("class", `column_ordering ${headerOrderArrow}`);

            // Reset arrows on rest of table headers
            // let headers = $(`.op-data-table-view th a:not([data-slug="opusid"], [data-slug=${slug}])`).find("span:last");
            let headers = $(`.op-data-table-view th a:not([data-slug=${slug}])`).find("span:last");
            headers.data("sort", "none");
            headers.attr("class", defaultTableSortArrow);
        }

        // Re-render each pill
        let listHtml = "";
        $.each(opus.prefs.order, function(index, orderEntry) {
            let isPillOrderDesc = orderEntry[0] === "-" ? "true" : "false";
            let pillOrderArrow = orderEntry[0] === "-" ? pillSortUpArrow : pillSortDownArrow;
            let orderEntrySlug = orderEntry[0] === "-" ? orderEntry.slice(1) : orderEntry;

            // retrieve label from either displayed header's data-label attribute or displayed pill's text
            let label = $(`.op-data-table-view th a[data-slug="${orderEntrySlug}"]`).data("label") || $(`.sort-contents span[data-slug="${orderEntrySlug}"] .flip-sort`).text();

            listHtml += "<li class='list-inline-item'>";
            listHtml += `<span class='badge badge-pill badge-light' data-slug="${orderEntrySlug}" data-descending="${isPillOrderDesc}">`;
            if (orderEntrySlug !== "opusid") {
                listHtml += "<span class='remove-sort' title='Remove metadata field from sort'><i class='fas fa-times-circle'></i></span> ";
            }
            listHtml += `<span class='flip-sort' title="${pillOrderTooltip}">`;
            listHtml += label;
            listHtml += ` <i class="${pillOrderArrow}"></i>`;
            listHtml += "</span></span></li>";
        });
        $(".sort-contents").html(listHtml);
    },

    renderSortedDataFromBeginning: function() {
        opus.prefs.startobs = 1; // reset startobs to 1 when col ordering changes
        opus.prefs.cart_startobs = 1;

        o_browse.galleryBegun = false;     // so that we redraw from the beginning
        o_browse.galleryData = {};
        o_browse.loadData(opus.prefs.view, 1);
    },

    // check if we need infiniteScroll to load next page when there is no more prefected data
    loadNextPageIfNeeded: function(opusId) {
        // opusId will be empty at the end of the observations, so just return out.
        if (opusId === "") {
            return;
        }
        let startObsLabel = o_browse.getStartObsLabel();
        let tab = opus.getViewTab();
        let contentsView = o_browse.getScrollContainerClass();
        let maxObs = (opus.prefs.view === "cart" ? o_cart.cartCount : opus.resultCount);

        let obsNum = $(`${tab} .thumbnail-container[data-id=${opusId}]`).data("obs") + 1;
        if (obsNum <= maxObs) {
            let nextElem = $(`${tab} .thumbnail-container[data-obs=${obsNum}]`);
            if (nextElem.length === 0) {
                // disable keydown on modal when it's loading
                // this will make sure we have correct html elements displayed for prev observation
                $("#galleryViewContents").addClass("op-disabled");
                opus.prefs[startObsLabel] = obsNum;
                $(`${tab} ${contentsView}`).infiniteScroll("loadNextPage");
            }
        }
    },

    loadPrevPageIfNeeded: function(opusId) {
        // if opusId is ever empty, return out.
        if (opusId === "") {
            return;
        }
        let startObsLabel = o_browse.getStartObsLabel();
        let tab = opus.getViewTab();
        let contentsView = o_browse.getScrollContainerClass();
        o_browse.currentOpusId = opusId;
        // decrement obsNum to see if there is a previous one to retrieve
        let obsNum = $(`${tab} .thumbnail-container[data-id=${opusId}]`).data("obs") - 1;
        if (obsNum > 0) {
            let prevElem = $(`${tab} .thumbnail-container[data-obs=${obsNum}]`);
            // if it's not there go retrieve it...
            if (prevElem.length === 0) {
                // disable keydown on modal when it's loading
                // this will make sure we have correct html elements displayed for prev observation
                $("#galleryViewContents").addClass("op-disabled");
                let startObs = obsNum - o_browse.getLimit();
                opus.prefs[startObsLabel] = (startObs > 0 ? startObs : 1);
                $(`${tab} ${contentsView}`).infiniteScroll("loadNextPage");
            }
        }
    },

    setScrollbarPosition: function(obsNum, view) {
        let tab = opus.getViewTab(view);
        let galleryTarget = $(`${tab} .thumbnail-container[data-obs="${obsNum}"]`);
        let tableTarget = $(`${tab} .op-data-table tbody tr[data-obs='${obsNum}']`);

        // Make sure obsNum is rendered before setting scrollbar position
        if (galleryTarget.length && tableTarget.length) {
            let galleryTargetTopPosition = galleryTarget.offset().top;
            let galleryContainerTopPosition = $(`${tab} .gallery-contents .op-gallery-view`).offset().top;
            let galleryScrollbarPosition = $(`${tab} .gallery-contents .op-gallery-view`).scrollTop();

            let galleryTargetFinalPosition = galleryTargetTopPosition - galleryContainerTopPosition + galleryScrollbarPosition;
            $(`${tab} .gallery-contents .op-gallery-view`).scrollTop(galleryTargetFinalPosition);

            // make sure it's scrolled to the correct position in table view
            let tableTargetTopPosition = tableTarget.offset().top;
            let tableContainerTopPosition = $(`${tab} .op-data-table-view`).offset().top;
            let tableScrollbarPosition = $(`${tab} .op-data-table-view`).scrollTop();
            let tableHeaderHeight = $(`${tab} .op-data-table thead th`).outerHeight();

            let tableTargetFinalPosition = (tableTargetTopPosition - tableContainerTopPosition +
                                            tableScrollbarPosition - tableHeaderHeight);
            $(`${tab} .op-data-table-view`).scrollTop(tableTargetFinalPosition);
        }
    },

    // called when the slider is moved...
    onUpdateSliderHandle: function(value) {
        value = (value == undefined? 1 : value);
        $("#op-observation-number").html(o_utils.addCommas(value));
    },

    // This function will be called when we scroll the slide to a target value
    onUpdateSlider: function(value) {
        let view = opus.prefs.view;
        let tab = opus.getViewTab(view);
        let elem = $(`${tab} .thumbnail-container[data-obs="${value}"]`);
        let startObsLabel = o_browse.getStartObsLabel();

        // Update obsNum in infiniteScroll instances.
        // This obsNum is the first item in current page
        // (will be used to set scrollbar position in renderGalleryAndTable).
        $(`${tab} .op-gallery-view`).infiniteScroll({"obsNum": value});
        $(`${tab} .op-data-table-view`).infiniteScroll({"obsNum": value});
        opus.prefs[startObsLabel] = value;

        if (elem.length > 0) {
            o_browse.setScrollbarPosition(value);
        } else {
            // When scrolling on slider and loadData is called, we will fetch 3 * getLimit items
            // (one current page, one next page, and one previous page) starting from obsNum.
            // obsNum will be the very first obs for data rendering this time
            let obsNum = Math.max(value - o_browse.getLimit(), 1);

            // If obsNum is 1, previous page will have value - 1 items, so we render value - 1 + 2 * o_browse.getLimit() items
            // else we render 2 * o_browse.getLimit() items.
            let customizedLimitNum = obsNum === 1 ? value - 1 + 2 * o_browse.getLimit() : 3 * o_browse.getLimit();
            o_browse.galleryBegun = false;
            o_browse.loadData(view, obsNum, customizedLimitNum);
        }
    },

    // find the first displayed observation index & id in the upper left corner
    updateSliderHandle: function(browserResized=false) {
        let tab = opus.getViewTab();
        let browse = o_browse.getBrowseView();
        let selector = ((opus.prefs[browse] === "gallery") ?
                        `${tab} .gallery .thumbnail-container` :
                        `${tab} .op-data-table tbody tr`);
        let topBoxBoundary;
        let startObsLabel = o_browse.getStartObsLabel();

        if ($(selector).length > 0) {
            let namespace = opus.getViewNamespace();
            let galleryBoundingRect = namespace.galleryBoundingRect;

            // this will get the top left obsNum for gallery view or the top obsNum for table view
            let firstCachedObs = $(selector).first().data("obs");
            let firstCachedObsTop = $(selector).first().offset().top;
            let calculatedFirstObs = (Math.floor((firstCachedObs - 1)/galleryBoundingRect.x + 0.0000001) *
                                      galleryBoundingRect.x + 1);
            // Fot gallery view, the topBoxBoundary is the top of .gallery-contents
            // For table view, we will set the topBoxBoundary to be the bottom of thead
            // (account for height of thead)
            topBoxBoundary = (topBoxBoundary ||
                              (opus.prefs[browse]  === "gallery") ?
                              $(`${tab} .gallery-contents`).offset().top :
                              $(`${tab} .gallery-contents`).offset().top + $(`${tab} .op-data-table thead th`).outerHeight());

            // table: obsNum = calculatedFirstObs + number of row
            // gallery: obsNum = calculatedFirstObs + number of row * number of obs in a row
            let obsNumDiff = ((opus.prefs[browse] === "gallery") ?
                              Math.round((topBoxBoundary - firstCachedObsTop)/o_browse.imageSize) *
                              galleryBoundingRect.x :
                              Math.round((topBoxBoundary - firstCachedObsTop)/$(`${tab} tbody tr`).outerHeight()));
            let obsNum = obsNumDiff + calculatedFirstObs;

            if (browserResized) {
                // At this point of time, galleryBoundingRect is updated with new row size
                // from countGalleryImages in adjustBrowseHeight.
                let numToDelete = ((galleryBoundingRect.x - (firstCachedObs - 1) % galleryBoundingRect.x) %
                                   galleryBoundingRect.x);

                let galleryObsElem = $(`${tab} .gallery [data-obs]`);
                let tableObsElem = $(`${tab} .op-data-table-view [data-obs]`);
                // delete first "numToDelete" obs if row size is changed
                if (numToDelete !== 0) {
                    for (let count = 0; count < numToDelete; count++) {
                        o_browse.deleteCachedObservation(galleryObsElem, tableObsElem, count);
                    }
                }
            }

            let dataResultCount = tab === "#browse" ? opus.resultCount : o_cart.cartCount;
            let firstObsInLastRow = (Math.floor((dataResultCount - 1)/galleryBoundingRect.x + 0.0000001) *
                                galleryBoundingRect.x + 1);
            let maxSliderVal = firstObsInLastRow - galleryBoundingRect.x * (galleryBoundingRect.y - 1);

            // Update obsNum in both infiniteScroll instances.
            // Store the most top left obsNum in gallery for both infiniteScroll instances
            // (this will be used to updated slider obsNum).
            if (opus.prefs[browse] !== "gallery") {
                obsNum = (Math.floor((obsNum - 1)/galleryBoundingRect.x + 0.0000001) *
                          galleryBoundingRect.x + 1);
            }

            if (maxSliderVal >= obsNum) {
                $(`${tab} .op-gallery-view`).infiniteScroll({"obsNum": obsNum});
                $(`${tab} .op-data-table-view`).infiniteScroll({"obsNum": obsNum});
                opus.prefs[startObsLabel] = obsNum;

                $("#op-observation-number").html(o_utils.addCommas(obsNum));
                $(".op-slider-pointer").css("width", `${o_utils.addCommas(maxSliderVal).length*0.7}em`);
                // $(".op-slider-pointer").css("width", `${opus.resultCount.toString().length*0.7}em`);
                // just make the step size the number of the obserations across the page...
                // if the observations have not yet been rendered, leave the default, it will get changed later
                if (galleryBoundingRect.x > 0) {
                    o_browse.gallerySliderStep = galleryBoundingRect.x;
                }
                $("#op-observation-slider").slider({
                    "value": obsNum,
                    "step": o_browse.gallerySliderStep,
                    "max": maxSliderVal,
                });
            }
            // update startobs in url when scrolling
            o_hash.updateHash(true);
        }
    },

    checkScroll: function() {
        // this will make sure ps-scroll-up is triggered to prefetch
        // previous data when scrollbar reaches to up scroll threshold point.
        let tab = opus.getViewTab();
        let contentsView = o_browse.getScrollContainerClass();
        if ($(`${tab} ${contentsView}`).scrollTop() < infiniteScrollUpThreshold) {
            $(`${tab} ${contentsView}`).trigger("ps-scroll-up");
        }
        o_browse.updateSliderHandle();
        return false;
    },

    showModal: function(opusId) {
        o_browse.loadPrevPageIfNeeded(opusId);
        o_browse.updateGalleryView(opusId);
        $("#galleryView").modal("show");

        // Do the fake API call to write in the Apache log files that
        // we showed the modal for this OPUSID. This is what the previous
        // version of OPUS did so the log_analyzer already handles it. Note that
        // we won't get separate log entries as the user navigates through
        // the obs using the arrows because we don't want to overload the
        // network with an entry for each opus id.
        let fakeUrl = `/opus/__fake/__viewmetadatamodal/${opusId}.json`;
        $.getJSON(fakeUrl, function(data) {
        });

    },

    hideMenu: function() {
        $("#op-obs-menu").removeClass("show").hide();
    },

    showMenu: function(e, opusId) {
        // make this like a default right click menu
        if ($("#op-obs-menu").hasClass("show")) {
            o_browse.hideMenu();
        }
        let inCart = (o_cart.isIn(opusId) ? "" : "in");
        let buttonInfo = o_browse.cartButtonInfo(inCart);
        $("#op-obs-menu .dropdown-header").html(opusId);
        $("#op-obs-menu .cart-item").html(`<i class="${buttonInfo.icon}"></i>${buttonInfo.title}`);
        $("#op-obs-menu [data-action='cart']").attr("data-id", opusId);
        $("#op-obs-menu [data-action='info']").attr("data-id", opusId);
        $("#op-obs-menu [data-action='downloadCSV']").attr("href",`/opus/__api/metadata_v2/${opusId}.csv?cols=${opus.prefs.cols.join()}`);
        $("#op-obs-menu [data-action='downloadCSVAll']").attr("href",`/opus/__api/metadata_v2/${opusId}.csv`);
        $("#op-obs-menu [data-action='downloadData']").attr("href",`/opus/__api/download/${opusId}.zip?cols=${opus.prefs.cols.join()}`);
        $("#op-obs-menu [data-action='downloadURL']").attr("href",`/opus/__api/download/${opusId}.zip?urlonly=1&cols=${opus.prefs.cols.join()}`);

        // use the state of the current selected observation to set the icons if one has been selected,
        // otherwise use the state of the current observation - this will identify what will happen to the range
        let tab = opus.getViewTab();
        let selectedElem = $(tab).find(".selected");

        if (selectedElem.length != 0) {
            inCart = (o_cart.isIn($(selectedElem).data("id")) ? "" : "in");
        }
        let addRemoveText = (inCart != "in" ? "remove range from" : "add range to");

        let rangeText = (selectedElem.length === 0 ?
                            `<i class='fas fa-sign-out-alt'></i>Start ${addRemoveText} cart here` :
                            `<i class='fas fa-sign-out-alt fa-rotate-180'></i>End ${addRemoveText} cart here`);
        $("#op-obs-menu .dropdown-item[data-action='range']").html(rangeText);

        let menu = {"height":$("#op-obs-menu").innerHeight(), "width":$("#op-obs-menu").innerWidth()};

        let top = ($(tab).innerHeight() - e.pageY > menu.height) ? e.pageY-5 : e.pageY-menu.height;
        let left = ($(tab).innerWidth() - e.pageX > menu.width)  ? e.pageX-5 : e.pageX-menu.width;

        $("#op-obs-menu").css({
            display: "block",
            top: top,
            left: left
        }).addClass("show")
            .attr("data-id", opusId);
    },

    showDetail: function(e, opusId) {
        opus.prefs.detail = opusId;
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
            // handles command click to open in new tab
            let hashArray = o_hash.getHashArray();
            hashArray.detail = opusId;
            let link = "/opus/#/" + o_hash.hashArrayToHashString(hashArray);
            link = link.replace("view=browse", "view=detail");
            window.open(link, '_blank');
        } else {
            opus.prefs.detail = opusId;
            opus.changeTab("detail");
            $('a[href="#detail"]').tab("show");
        }
    },

    getGalleryElement: function(opusId) {
        let tab = opus.getViewTab();
        return $(`${tab} .thumbnail-container[data-id=${opusId}]`);
    },

    getDataTableInputElement: function(opusId) {
        return $(`.op-data-table div[data-id=${opusId}]`).parent();
    },

    startRangeSelect: function(opusId) {
        o_browse.undoRangeSelect(); // probably not necessary...
        o_browse.getGalleryElement(opusId).addClass("selected hvr-ripple-in b-a-2");
        o_browse.getDataTableInputElement(opusId).addClass("hvr-ripple-in b-a-2");
    },

    undoRangeSelect: function() {

        let tab = opus.getViewTab();
        let startElem = $(tab).find(".selected");

        if (startElem.length) {
            $(startElem).removeClass("op-selected hvr-ripple-in b-a-2");
            let opusId = $(startElem).data("id");
            o_browse.getDataTableInputElement(opusId).removeClass("hvr-ripple-in b-a-2");
        }
    },

    openDetailTab: function() {
        $("#galleryView").modal("hide");
        opus.changeTab("detail");
    },

    // columns can be reordered wrt each other in 'metadata selector' by dragging them
    metadataDragged: function(element) {
        let cols = $.map($(element).sortable("toArray"), function(item) {
            return item.split("__")[1];
        });
        opus.prefs.cols = cols;
    },

    addColumn: function(slug) {
        let elem = $(`#op-metadata-selector .op-all-metadata-column a[data-slug=${slug}]`);
        elem.find("i.fa-check").fadeIn().css("display", "inline-block");

        let label = elem.data("qualifiedlabel");
        let info = '<i class = "fas fa-info-circle" title = "' + elem.find('*[title]').attr("title") + '"></i>';
        let html = `<li id = "cchoose__${slug}">${label}${info}<span class="unselect"><i class="far fa-trash-alt"></span></li>`;
        $(".op-selected-metadata-column > ul").append(html);
    },

    resetMetadata: function(cols, closeModal) {
        opus.prefs.cols = cols.slice();

        if (closeModal == true) {
            $("#op-metadata-selector").modal('hide');
        }

        // uncheck all on left; we will check them as we go
        $("#op-metadata-selector .op-all-metadata-column .fa-check").hide();

        // remove all from selected column
        $("#op-metadata-selector .op-selected-metadata-column li").remove();

        // add them back and set the check
        $.each(cols, function(index, slug) {
            o_browse.addColumn(slug);
        });
    },

    // metadata selector behaviors
    addMetadataSelectorBehaviors: function() {
        // Global within this function so behaviors can communicate
        /* jshint varstmt: false */
        var currentSelectedMetadata = opus.prefs.cols.slice();
        /* jshint varstmt: true */

        $("#op-metadata-selector").on("hide.bs.modal", function(e) {
            // update the data table w/the new columns
            if (!o_utils.areObjectsEqual(opus.prefs.cols, currentSelectedMetadata)) {
                let tab = opus.getViewTab();
                o_browse.resetData();
                o_browse.initTable(tab, opus.colLabels, opus.colLabelsNoUnits);
                o_browse.loadData(opus.prefs.view);
            } else {
                // remove spinner if nothing is re-draw when we click save changes
                $(".op-page-loading-status > .loader").hide();
            }
        });

        $("#op-metadata-selector").on("show.bs.modal", function(e) {
            // save current column state so we can look for changes
            currentSelectedMetadata = opus.prefs.cols.slice();

            o_browse.hideMenu();
            o_browse.renderMetadataSelector();

            // Do the fake API call to write in the Apache log files that
            // we invoked the metadata selector so log_analyzer has something to
            // go on
            let fakeUrl = "/opus/__fake/__selectmetadatamodal.json";
            $.getJSON(fakeUrl, function(data) {
            });
        });

        $("#op-metadata-selector .op-all-metadata-column").on("click", '.submenu li a', function() {
            let slug = $(this).data('slug');
            if (!slug) { return; }

            let chosenSlugSelector = `#cchoose__${slug}`;
            let label = $(this).data('qualifiedlabel');

            //CHANGE THESE TO USE DATA-ICON=
            let def = $(this).find('i.fa-info-circle').attr("title");
            let selectedMetadata = $(this).find("i.fa-check");

            if ($(chosenSlugSelector).length === 0) {
                selectedMetadata.fadeIn();
                // this slug was previously unselected, add to cols
                let html = `<li id = "${chosenSlugSelector.substr(1)}">`;
                html +=      `${label}`;
                html +=      `<span class="info">&nbsp;<i class = "fas fa-info-circle" title = "${def}"></i>&nbsp;&nbsp;&nbsp;</span>`;
                html +=      `<span class="unselect"><i class="far fa-trash-alt"></span>`;
                html +=    `</li>`;
                $(".selectedMetadata > ul").append(html).fadeIn();
                opus.prefs.cols.push(slug);
            } else {
                selectedMetadata.hide();
                // slug had been checked, remove from the chosen
                opus.prefs.cols.splice($.inArray(slug,opus.prefs.cols),1);
                $(chosenSlugSelector).remove();
            }
            return false;
        });

        // removes chosen column
        $("#op-metadata-selector .op-selected-metadata-column").on("click", "li .unselect", function() {
            if (opus.prefs.cols.length <= 1) {
                return;     // prevent user from removing all the columns
            }
            let slug = $(this).parent().attr("id").split('__')[1];

            if ($.inArray(slug, opus.prefs.cols) >= 0) {
                // slug had been checked, removed from the chosen
                opus.prefs.cols.splice($.inArray(slug, opus.prefs.cols), 1);
                $(`#cchoose__${slug}`).fadeOut(200, function() {
                    $(this).remove();
                });
                $(`#op-metadata-selector .op-all-metadata-column [data-slug=${slug}]`).find("i.fa-check").hide();
            }
            return false;
        });

        // buttons
        $("#op-metadata-selector").on("click", ".btn", function() {
            switch($(this).attr("type")) {
                case "reset":
                    opus.prefs.cols = [];
                    o_browse.resetMetadata(opus.defaultColumns);
                    break;
                case "submit":
                    $(".op-page-loading-status > .loader").show();
                    break;
                case "cancel":
                    $('#myModal').modal('hide');
                    opus.prefs.cols = [];
                    o_browse.resetMetadata(currentSelectedMetadata, true);
                    break;
            }
        });
    },  // /addMetadataSelectorBehaviors

    // there are interactions that are applied to different code snippets,
    // this returns the namespace, view_var
    // that distinguishes cart vs result tab views
    // NOTE: get rid of all this with a framework!
    // usage:
    // utility function to figure out what view we are in
    /*
        // usage
        view_info = o_browse.getViewInfo();
        namespace = view_info['namespace'];
        prefix = view_info['prefix'];
    */
    getViewInfo: function() {
        // this function returns some data you need depending on whether
        // you are in #cart or #browse views
        let namespace = "#browse";
        let prefix = "";
        if (opus.prefs.view == "cart") {
            namespace = "#cart";
            prefix = "cart_";
        }
        return {"namespace":namespace, "prefix":prefix};

    },

    updateBrowseNav: function() {
        o_browse.fading = true;
        let tab = opus.getViewTab();
        let browse = o_browse.getBrowseView();
        let contentsView = o_browse.getScrollContainerClass();
        let galleryInfiniteScroll = $(`${tab} .op-gallery-view`).data("infiniteScroll");
        let tableInfiniteScroll = $(`${tab} .op-data-table-view`).data("infiniteScroll");

        let suppressScrollY = false;

        if (opus.prefs[browse] == "gallery") {
            $(".op-data-table-view", tab).hide();
            $(".op-gallery-view", tab).fadeIn("done", function() {o_browse.fading = false;});

            $(".op-browse-view", tab).html("<i class='far fa-list-alt'></i>&nbsp;View Table");
            $(".op-browse-view", tab).attr("title", "View sortable metadata table");
            $(".op-browse-view", tab).data("view", "data");

            suppressScrollY = false;
        } else {
            $(".op-gallery-view", tab).hide();
            $(".op-data-table-view", tab).fadeIn("done", function() {o_browse.fading = false;});

            $(".op-browse-view", tab).html("<i class='far fa-images'></i>&nbsp;View Gallery");
            $(".op-browse-view", tab).attr("title", "View sortable thumbnail gallery");
            $(".op-browse-view", tab).data("view", "gallery");

            suppressScrollY = true;
        }
        opus.getViewNamespace().galleryScrollbar.settings.suppressScrollY = suppressScrollY;

        // sync up scrollbar position
        if (galleryInfiniteScroll && tableInfiniteScroll) {
            let startObs = $(`${tab} ${contentsView}`).data("infiniteScroll").options.obsNum;
            o_browse.setScrollbarPosition(startObs);
        }
    },

    updateStartobsInUrl: function(view, url, startObs) {
        let obsStr = o_browse.getStartObsLabel(view);
        // remove any existing startobs= slug
        url = $.grep(url.split('&'), function(pair, index) {
            return !pair.startsWith(obsStr);
        }).join('&');

        url += `&${obsStr}=${startObs}`;
        return url;
    },

    updateViewInUrl: function(view, url) {
        // remove any existing view= slug
        let slug = "view";
        url = $.grep(url.split('&'), function(pair, index) {
            return !pair.startsWith(slug);
        }).join('&');

        url += `&${slug}=${view}`;
        return url;
    },

    renderMetadataSelector: function() {
        if (!o_browse.metadataSelectorDrawn) {
            let url = "/opus/__forms/metadata_selector.html?" + o_hash.getHash();
            $(".modal-body.metadata").load( url, function(response, status, xhr)  {

                o_browse.metadataSelectorDrawn = true;  // bc this gets saved not redrawn
                $("#op-metadata-selector .op-reset-button").hide(); // we are not using this

                // since we are rendering the left side of metadata selector w/the same code that builds the select menu,
                // we need to unhighlight the selected widgets
                o_menu.markMenuItem(".modal-body.metadata li", "unselect");

                // we keep these all open in the metadata selector, they are all closed by default
                // disply check next to any default columns
                $.each(opus.prefs.cols, function(index, col) { //CHANGE BELOW TO USE DATA-ICON=
                    $(`.modal-body.metadata li > [data-slug="${col}"]`).find("i.fa-check").fadeIn().css('display', 'inline-block');
                });

                o_browse.addMetadataSelectorBehaviors();

                o_browse.allMetadataScrollbar = new PerfectScrollbar("#op-metadata-selector-contents .op-all-metadata-column", {
                    minScrollbarLength: opus.minimumPSLength
                });
                o_browse.selectedMetadataScrollbar = new PerfectScrollbar("#op-metadata-selector-contents .op-selected-metadata-column", {
                    minScrollbarLength: opus.minimumPSLength
                });

                // dragging to reorder the chosen
                $( ".op-selected-metadata-column > ul").sortable({
                    items: "li",
                    cursor: "grab",
                    stop: function(event, ui) { o_browse.metadataDragged(this); }
                });
            });
        }
    },

    renderGalleryAndTable: function(data, url, view) {
        // render the gallery and table at the same time.
        let tab = opus.getViewTab(view);
        let contentsView = o_browse.getScrollContainerClass(view);
        let selector = `${tab} ${contentsView}`;
        let infiniteScrollData = $(selector).data("infiniteScroll");

        // this is the list of all observations requested from dataimages.json
        let galleryHtml = "";
        let tableHtml = "";

        if (data.count == 0) {
            // either there are no selections OR this is signaling the end of the infinite scroll
            // for now, just post same message to both #browse & #cart tabs
            if (data.start_obs == 1) {
                if (view === "browse") {
                    // note: this only displays in gallery view; might want to gray out option for table view when no search results.
                    galleryHtml += '<div class="thumbnail-message">';
                    galleryHtml += '<h2>Your search produced no results</h2>';
                    galleryHtml += '<p>Remove or edit one or more of the search criteria selected on the Search tab ';
                    galleryHtml += 'or click on the Reset Search button to reset the search criteria to default.</p>';
                    galleryHtml += '</div>';
                } else {
                    $("#cart .navbar").hide();
                    $("#cart .sort-order-container").hide();
                    galleryHtml += '<div class="thumbnail-message">';
                    galleryHtml += '<h2>Your cart is empty</h2>';
                    galleryHtml += '<p>To add observations to the cart, click on the Browse Results tab ';
                    galleryHtml += 'at the top of the page, mouse over the thumbnail gallery images to reveal the tools, ';
                    galleryHtml += 'then click on the cart icon.  </p>';
                    galleryHtml += '</div>';
                }
                $(".gallery", tab).html(galleryHtml);
            } else {
                // we've hit the end of the infinite scroll.
                $(".op-page-loading-status > .loader").hide();
                return;
            }
        } else {
            let append = (data.start_obs > $(`${tab} .thumbnail-container`).last().data("obs"));

            o_browse.manageObservationCache(data.count, append, view);
            $(`${tab} .navbar`).show();
            $(`${tab} .sort-order-container`).show();

            opus.resultCount = data.result_count;

            $.each(data.page, function(index, item) {
                let opusId = item.opusid;
                // we have to store the relative observation number because we may not have pages in succession, this is for the slider position
                o_browse.galleryData[opusId] = item.metadata;	// for galleryView, store in global array

                // gallery
                let images = item.images;

                galleryHtml += `<div class="thumbnail-container ${(item.in_cart ? "op-in-cart" : "")}" data-id="${opusId}" data-obs="${item.obs_num}">`;
                galleryHtml += `<a href="#" class="thumbnail" data-image="${images.full.url}">`;
                galleryHtml += `<img class="img-thumbnail img-fluid" src="${images.thumb.url}" alt="${images.thumb.alt_text}" title="${item.obs_num} - ${opusId}\r\nClick to enlarge">`;
                // whenever the user clicks an image to show the modal, we need to highlight the selected image w/an icon
                galleryHtml += '<div class="modal-overlay">';
                galleryHtml += '<p class="content-text"><i class="fas fa-binoculars fa-4x text-info" aria-hidden="true"></i></p>';
                galleryHtml += '</div></a>';

                galleryHtml += '<div class="op-thumb-overlay">';
                galleryHtml += `<div class="op-tools dropdown" data-id="${opusId}">`;
                galleryHtml +=     '<a href="#" data-icon="info" title="View observation detail"><i class="fas fa-info-circle fa-xs"></i></a>';

                let buttonInfo = o_browse.cartButtonInfo((item.in_cart ? 'add' : 'remove'));
                galleryHtml +=     `<a href="#" data-icon="cart" title="${buttonInfo.title}"><i class="${buttonInfo.icon} fa-xs"></i></a>`;
                galleryHtml +=     '<a href="#" data-icon="menu"><i class="fas fa-bars fa-xs"></i></a>';
                galleryHtml += '</div>';
                galleryHtml += '</div></div>';

                // table row
                let checked = item.in_cart ? " checked" : "";
                let checkbox = `<input type="checkbox" name="${opusId}" value="${opusId}" class="multichoice"${checked}/>`;
                let minimenu = `<a href="#" data-icon="menu"><i class="fas fa-bars fa-xs"></i></a>`;
                let row = `<td class="op-table-tools"><div class="op-tools mx-0 form-group" title="${item.obs_num}" data-id="${opusId}">${checkbox} ${minimenu}</div></td>`;
                let tr = `<tr data-id="${opusId}" data-target="#galleryView" data-obs="${item.obs_num}">`;
                $.each(item.metadata, function(index, cell) {
                    row += `<td>${cell}</td>`;
                });
                tableHtml += `${tr}${row}</tr>`;
            });

            galleryHtml += "</div>";
            // wondering if there should be more logic here to determine if the new block of observations
            // is contiguous w/the existing block of observations, not just before/after...
            if (append) {
                $(".gallery", tab).append(galleryHtml);
                $(".op-data-table-view tbody", tab).append(tableHtml);
            } else {
                $(".gallery", tab).prepend(galleryHtml);
                $(".op-data-table-view tbody", tab).prepend(tableHtml);
            }
        }

        // Note: we have to manually set the scrollbar position.
        // - scroll up: when we scroll up and a new page is fetched, we want to keep scrollbar position at the current startObs,
        //   instead of at the first item in newly fetched page.
        // - scroll slider: when we load 3 * getLimit items, we want to keep scrollbar in the middle page.
        // - scroll down: theoretically, infiniteScroll will take care of scrollbar position, but we still have to manually set
        //   it for the case when cached data is removed so that scrollbar position is always correct (and never reaches to the
        //   end until it reaches to the end of the data)
        o_browse.setScrollbarPosition(infiniteScrollData.options.obsNum, view);

        $(".op-page-loading-status > .loader").hide();
        o_browse.updateSliderHandle();
        o_hash.updateHash(true);
    },

    initTable: function(tab, columns, columnsNoUnits) {
        // prepare table and headers...
        $(`${tab} .op-data-table > thead`).empty();
        $(`${tab} .op-data-table > tbody`).empty();

        // NOTE:  At some point, ORDER needs to be identified in the table, as to which column we are ordering on

        // because i need the slugs for the columns
        let hashArray = o_hash.getHashArray();
        let slugs = hashArray.cols.split(",");
        let order = hashArray.order.split(",");
        // we only want to sort the column based on first slug in order for now
        order.splice(1);

        opus.colLabels = columns;
        opus.colLabelsNoUnits = columnsNoUnits;

        // check all box
        //let checkbox = "<input type='checkbox' name='all' value='all' class='multichoice'>";
        $(`${tab} .op-data-table-view thead`).append("<tr></tr>");
        $(`${tab} .op-data-table-view thead tr`).append("<th scope='col' class='sticky-header'></th>");
        $.each(columns, function(index, header) {
            let slug = slugs[index];

            // Store label (without units) of each header in data-label attributes
            let label = columnsNoUnits[index];

            // Assigning data attribute for table column sorting
            let icon = ($.inArray(slug, order) >= 0 ? "-down" : ($.inArray("-"+slug, order) >= 0 ? "-up" : ""));
            let columnSorting = icon === "-down" ? "sort-asc" : icon === "-up" ? "sort-desc" : "none";
            let columnOrdering = `<a href='' data-slug='${slug}' data-label='${label}'><span>${header}</span><span data-sort='${columnSorting}' class='column_ordering fas fa-sort${icon}'></span></a>`;

            $(`${tab} .op-data-table-view thead tr`).append(`<th id='${slug} 'scope='col' class='sticky-header'><div>${columnOrdering}</div></th>`);
        });

        o_browse.initResizableColumn(tab);
    },

    initResizableColumn: function(tab) {
        $(`${tab} .op-data-table th div`).resizable({
            handles: "e",
            minWidth: 40,
            resize: function(event, ui) {
                let resizableContainerWidth = $(event.target).parent().width();
                let columnTextWidth = $(event.target).find("a span:first").width();
                let sortLabelWidth = $(event.target).find("a span:last").width();
                let columnContentWidth = columnTextWidth + sortLabelWidth;
                let beginningSpace = (resizableContainerWidth - columnContentWidth)/2;
                let columnWidthUptoEndContent = columnContentWidth + beginningSpace;

                if (ui.size.width > columnWidthUptoEndContent) {
                    $(event.target).width(ui.size.width);
                    $(event.target).parent().width(ui.size.width);
                    $(event.target).parent().height(ui.size.height);
                    $(event.target).find("div").height($(event.target).parent().height());
                } else {
                    let tableCellWidth = $(event.target).parent().width();
                    let resizableElementWidth = tableCellWidth > columnContentWidth ? tableCellWidth : columnContentWidth;
                    $(event.target).width(resizableElementWidth);
                    $(event.target).find("div").height($(event.target).parent().height());
                    // Make sure resizable handle is always at the right border of th
                    $(event.target).attr("style", "width: 100%");
                }
            },
        });
    },

    updateSortOrder: function(data) {
        let listHtml = "";
        opus.prefs.order = [];
        $.each(data.order_list, function(index, order_entry) {
            let slug = order_entry.slug;
            let label = order_entry.label;
            let descending = order_entry.descending;
            let removeable = order_entry.removeable;
            listHtml += "<li class='list-inline-item'>";
            listHtml += `<span class='badge badge-pill badge-light' data-slug="${slug}" data-descending="${descending}">`;
            if (removeable) {
                listHtml += "<span class='remove-sort' title='Remove metadata field from sort'><i class='fas fa-times-circle'></i></span> ";
            }
            if (descending) {
                listHtml += "<span class='flip-sort' title='Change to ascending sort'>";
                listHtml += label;
                listHtml += ` <i class="${pillSortUpArrow}"></i>`;
            } else {
                listHtml += "<span class='flip-sort' title='Change to descending sort'>";
                listHtml += label;
                listHtml += ` <i class="${pillSortDownArrow}"></i>`;
            }
            listHtml += "</span></span></li>";
            let fullSlug = slug;
            if (descending) {
                fullSlug = "-"+slug;
            }
            opus.prefs.order.push(fullSlug);
        });
        $(".sort-contents").html(listHtml);
        o_hash.updateHash();
    },

    // number of images that can be fit in current window size
    getLimit: function(view) {
        // default the function to use to be the one in o_browse because there is not one available in o_search
        let galleryBoundingRect = opus.getViewNamespace(view).galleryBoundingRect;
        return (galleryBoundingRect.x * galleryBoundingRect.y);
    },

    getDataURL: function(view, startObs, customizedLimitNum=undefined) {
        let base_url = "/opus/__api/dataimages.json?";
        let hashString = o_hash.getHash();

        //TODO: we should be able to combine these url tweaker functions into a single function, perhaps in hash.js
        let url = hashString + '&reqno=' + opus.lastLoadDataRequestNo[view];
        url = o_browse.updateViewInUrl(view, url);
        url = base_url + o_browse.updateStartobsInUrl(view, url, startObs);

        // need to add limit - getting twice as much so that the prefetch is done in one get instead of two.
        let limitNum = customizedLimitNum === undefined ? o_browse.getLimit(view) * 2 : customizedLimitNum;
        if (limitNum === 0 || isNaN(limitNum)) {
            console.log(`limitNum:  ${limitNum}, customizedLimitNum = ${customizedLimitNum}`);
        }
        url += `&limit=${limitNum}`;

        return url;
    },

    // check the cache of both rendered elements and variable o_browse.galleryData; remove 'far away' observations
    // from cache to avoid buildup of too much data in the browser which slows things down
    // Two functions; one to delete single elements, just a tool for the main one, manageObservationCache, to loop.
    manageObservationCache: function(count, append, view) {
        let tab = opus.getViewTab(view);
        let galleryObsElem = $(`${tab} .gallery [data-obs]`);
        let tableObsElem = $(`${tab} .op-data-table-view [data-obs]`);

        if (galleryObsElem.length === 0) {
            // this only happens when there are no elements rendered, so why bother...
            // probably don't need to check both, but why not...
            return;
        }

        let lastIndex = galleryObsElem.last().index();
        let totalCachedObservations = lastIndex + 1;
        if (totalCachedObservations + count > o_browse.maxCachedObservations) {
            // if we are appending, remove from the top
            count = Math.min(count, totalCachedObservations);
            if (append) {
                // this is theoretically the faster way to delete lots of data, as jquery selector eval is slow
                for (let index = 0; index < count ; index++) {
                    o_browse.deleteCachedObservation(galleryObsElem, tableObsElem, index);
                }
            } else {
                let deleteTo = totalCachedObservations - count;
                for (let index = lastIndex; index >= deleteTo; index--) {
                    o_browse.deleteCachedObservation(galleryObsElem, tableObsElem, index);
                }
            }
        }
    },

    deleteCachedObservation: function(galleryObsElem, tableObsElem, index) {
        // don't delete the metadata if the observation is in the cart
        if (!galleryObsElem.eq(index).hasClass("in")) {
            let delOpusId = galleryObsElem.eq(index).data("id");
            delete o_browse.galleryData[delOpusId];
        }
        galleryObsElem.eq(index).remove();
        tableObsElem.eq(index).remove();
    },

    getBrowseView: function(view) {
        view = (view === undefined ? opus.prefs.view : view);
        return (view === "cart" ? "cart_browse" : "browse");
    },

    // return the infiniteScroll container class for either gallery or table view
    getScrollContainerClass: function(view) {
        view = (view === undefined ? opus.prefs.view : view);
        let browse = o_browse.getBrowseView(view);
        return (opus.prefs[browse] === "gallery" ? ".op-gallery-view" : ".op-data-table-view");
    },

    getStartObsLabel: function(view) {
        view = (view === undefined ? opus.prefs.view : view);
        return (view === "cart" ? "cart_startobs" : "startobs");
    },

    // Instantiate infiniteScroll
    initInfiniteScroll: function(view, selector) {
        let tab = `#${view}`;
        let startObsLabel = o_browse.getStartObsLabel(view);
        opus.getViewNamespace(view).galleryBoundingRect = o_browse.countGalleryImages(view);

        if (!$(selector).data("infiniteScroll")) {
            $(selector).infiniteScroll({
                path: function() {
                    let obsNum = opus.prefs[startObsLabel];
                    let customizedLimitNum;
                    let lastObs = $(`${tab} .thumbnail-container`).last().data("obs");
                    let firstCachedObs = $(`${tab} .thumbnail-container`).first().data("obs");

                    let infiniteScrollData = $(selector).data("infiniteScroll");
                    if (infiniteScrollData !== undefined && infiniteScrollData.options.loadPrevPage === true) {
                        // Direction: scroll up, we prefetch 1 * o_browse.getLimit() items
                        if (obsNum !== 1) {
                            // prefetch o_browse.getLimit() items ahead of firstCachedObs, update the startObs to be passed into url
                            obsNum = Math.max(firstCachedObs - o_browse.getLimit(view), 1);

                            // If obsNum to be passed into api url is 1, we will pass firstCachedObs - 1 as limit
                            // else we'll pass in o_browse.getLimit() as limit
                            customizedLimitNum = obsNum === 1 ? firstCachedObs - 1 : o_browse.getLimit(view);

                            // Update the obsNum in infiniteScroll instances with firstCachedObs
                            // This will be used to set the scrollbar position later
                            if (infiniteScrollData) {
                                $(`${tab} .op-gallery-view`).infiniteScroll({"obsNum": firstCachedObs});
                                $(`${tab} .op-data-table-view`).infiniteScroll({"obsNum": firstCachedObs});
                                opus.prefs[startObsLabel] = firstCachedObs;
                            }
                        } else {
                            customizedLimitNum = 0;
                        }
                    } else {
                        // Direction: scroll down, we prefetch 1 * o_browse.getLimit() items (symmetric to scroll up)
                        // NOTE: we can change the number of prefetch items by changing customizedLimitNum
                        // start from the last observation drawn; if none yet drawn, start from opus.prefs.startobs
                        obsNum = (lastObs !== undefined ? lastObs + 1 : obsNum);
                        customizedLimitNum = o_browse.getLimit(view);
                        let scrollbarObsNum = Math.max(obsNum - o_browse.getLimit(view) - opus.getViewNamespace(view).galleryBoundingRect.x, 1);

                        // Update the obsNum in infiniteScroll instances with the first obsNum of the row above current last page
                        // This will be used to set the scrollbar position later
                        if (infiniteScrollData) {
                            $(`${tab} .op-gallery-view`).infiniteScroll({"obsNum": scrollbarObsNum});
                            $(`${tab} .op-data-table-view`).infiniteScroll({"obsNum": scrollbarObsNum});
                            opus.prefs[startObsLabel] = scrollbarObsNum;
                        }
                    }
                    let path = o_browse.getDataURL(view, obsNum, customizedLimitNum);
                    return path;
                },
                responseType: "text",
                status: `${tab} .page-load-status`,
                elementScroll: true,
                history: false,
                // threshold point for scroll down
                scrollThreshold: 200,
                checkLastPage: false,
                loadPrevPage: false,
                // store the most top left obsNum in gallery or the most top obsNum in table
                obsNum: 1,
                debug: false,
            });

            $(selector).on("request.infiniteScroll", function(event, path) {
                // Remove spinner when infiniteScroll reaches to both ends
                let contentsView = o_browse.getScrollContainerClass(view);
                let infiniteScrollData = $(`${tab} ${contentsView}`).data("infiniteScroll");
                let firstObs = $(`${tab} .thumbnail-container`).first().data("obs");
                let lastObs = $(`${tab} .thumbnail-container`).last().data("obs");

                if (infiniteScrollData.options.loadPrevPage === true) {
                    if (firstObs === 1) {
                        $(".infinite-scroll-request").hide();
                    }
                } else {
                    if ((tab === "#browse" && lastObs === opus.resultCount) ||
                        (tab === "#cart" && lastObs === o_cart.cartCount)) {
                        $(".infinite-scroll-request").hide();
                    }
                }
            });

            function eventListenerWithView(event, response, path) {
                o_browse.infiniteScrollLoadEventListener(event, response, path, view);
            }
            $(selector).on("load.infiniteScroll", eventListenerWithView);
        }
    },

    loadData: function(view, startObs, customizedLimitNum=undefined) {
        let tab = opus.getViewTab(view);
        let startObsLabel = o_browse.getStartObsLabel(view);
        let contentsView = o_browse.getScrollContainerClass(view);

        let galleryInfiniteScroll = $(`${tab} .op-gallery-view`).data("infiniteScroll");
        let tableInfiniteScroll = $(`${tab} .op-data-table-view`).data("infiniteScroll");

        startObs = (startObs === undefined ? opus.prefs[startObsLabel] : startObs);

        if (o_browse.galleryBegun) {
            // if the request is a block far away from current page cache, flush the cache and start over
            let elem = $(`${tab} [data-obs="${startObs}"]`);
            let lastObs = $(`${tab} [data-obs]`).last().data("obs");
            let firstObs = $(`${tab} [data-obs]`).first().data("obs");

            // if the startObs is not already rendered and is obviously not contiguous, clear the cache and start over
            if (lastObs === undefined || firstObs === undefined || elem.length === 0 ||
                (startObs > lastObs + 1) || (startObs < firstObs - 1)) {
                o_browse.galleryBegun = false;
            } else {
                // wait! is this page already drawn?
                // if startObs drawn, move the slider to that line, fetch if need be after
                if (startObs >= firstObs && startObs <= lastObs) {
                    // may need to do a prefetch here...
                    if (galleryInfiniteScroll && tableInfiniteScroll) {
                        startObs = $(`${tab} ${contentsView}`).data("infiniteScroll").options.obsNum;
                    }
                    o_browse.setScrollbarPosition(startObs, view);
                    $(".op-page-loading-status > .loader").hide();
                    return;
                }
            }
        }

        $(".op-page-loading-status > .loader").show();
        // Note: when browse page is refreshed, startObs passed in (from activateBrowseTab) will start from 1
        let url = o_browse.getDataURL(view, startObs, customizedLimitNum);

        // metadata; used for both table and gallery
        $.getJSON(url, function(data) {
            if (data.reqno < opus.lastLoadDataRequestNo[view]) {
                // make sure to remove spinner before return
                $(".op-page-loading-status > .loader").hide();
                return;
            }

            if (!o_browse.galleryBegun || (view === "cart" && o_cart.cartChange)) {
                o_browse.initTable(tab, data.columns, data.columns_no_units);

                $(`${tab} .op-gallery-view`).scrollTop(0);
                $(`${tab} .op-data-table-view`).scrollTop(0);
            }

            // Because we redraw from the beginning or user inputted page, we need to remove previous drawn thumb-pages
            $(`${tab} .thumbnail-container`).remove();

            o_browse.renderGalleryAndTable(data, this.url, view);

            if (o_browse.currentOpusId != "") {
                o_browse.metadataboxHtml(o_browse.currentOpusId, view);
            }
            o_browse.updateSortOrder(data);

            // prefill next page
            if (!o_browse.galleryBegun) {
                o_browse.galleryBegun = true;
            }
            if (view === "cart") {
                o_cart.cartChange = false;
            }
        });
    },

    infiniteScrollLoadEventListener: function(event, response, path, view) {
        $(".op-page-loading-status > .loader").show();
        let data = JSON.parse(response);

        let tab = opus.getViewTab(view);

        o_browse.renderGalleryAndTable(data, path);
        $(`${tab} .op-gallery-view`).infiniteScroll({"loadPrevPage": false});
        $(`${tab} .op-data-table-view`).infiniteScroll({"loadPrevPage": false});

        // Maybe we only care to do this if the modal is visible...  right now, just let it be.
        // Update to make prev button appear when prefetching previous page is done
        if (!$("#galleryViewContents .prev").data("id") && $("#galleryViewContents .prev").hasClass("op-button-disabled")) {
            let prev = $(`${tab} tr[data-id=${o_browse.currentOpusId}]`).prev("tr");
            while (prev.hasClass("table-page")) {
                prev = prev.prev("tr");
            }
            prev = (prev.data("id") ? prev.data("id") : "");

            $("#galleryViewContents .prev").data("id", prev);
            $("#galleryViewContents .prev").removeClass("op-button-disabled");
        }

        // if left/right arrow are disabled, make them clickable again
        $("#galleryViewContents").removeClass("op-disabled");
    },

    activateBrowseTab: function() {
        // init o_browse.galleryBoundingRect
        opus.getViewNamespace().galleryBoundingRect = o_browse.countGalleryImages();
        // reset range select
        o_browse.undoRangeSelect();

        $(".op-page-loading-status > .loader").show();
        o_browse.updateBrowseNav();
        o_browse.renderMetadataSelector();   // just do this in background so there's no delay when we want it...

        let startObsLabel = o_browse.getStartObsLabel();
        let startObs = opus.prefs[startObsLabel];
        startObs = (startObs > opus.resultCount ? 1 : startObs);

        o_browse.loadData(opus.prefs.view, startObs);
    },

    countGalleryImages: function(view) {
        let tab = opus.getViewTab(view);

        let width = o_browse.calculateGalleryWidth(view);
        let height = o_browse.calculateGalleryHeight(view);

        let xCount = Math.floor(width/o_browse.imageSize);
        let yCount = Math.round(height/o_browse.imageSize);
        // let yCount = Math.ceil(height/o_browse.imageSize);

        return {"x": xCount, "y": yCount};
    },


    // calculate the height of the gallery by removing all the non-gallery contaniner elements
    calculateGalleryHeight: function(view) {
        let tab = opus.getViewTab(view);
        let footerHeight = $(".app-footer").outerHeight();
        let mainNavHeight = $("#op-main-nav").outerHeight();
        let navbarHeight = $(`${tab} .panel-heading`).outerHeight();
        let totalNonGalleryHeight = footerHeight + mainNavHeight + navbarHeight;
        return  $(window).height()-totalNonGalleryHeight;
    },

    calculateGalleryWidth: function(view) {
        let tab = opus.getViewTab(view);
        let width = $(`${tab} .gallery-contents`).width();
        if (width === 0) {
            width = $(window).width();
            if (tab === "#cart") {
                let leftPanelWidth = parseInt($(".cart_details").css("min-width"));
                width -= leftPanelWidth;
            }
        }
        return width;
    },

    adjustBrowseHeight: function(browserResized=false) {
        let tab = opus.getViewTab();
        let containerHeight = o_browse.calculateGalleryHeight();
        $(`${tab} .gallery-contents`).height(containerHeight);
        $(`${tab} .gallery-contents .op-gallery-view`).height(containerHeight);

        let namespace = opus.getViewNamespace();
        namespace.galleryScrollbar.update();
        namespace.galleryBoundingRect = o_browse.countGalleryImages();

        // make sure slider is updated when window is resized
        o_browse.updateSliderHandle(browserResized);
    },

    adjustTableSize: function() {
        let tab = opus.getViewTab();
        let containerWidth = $(`${tab} .gallery-contents`).width();
        let containerHeight = $(`${tab} .gallery-contents`).height();
        $(`${tab} .op-data-table-view`).width(containerWidth);
        $(`${tab} .op-data-table-view`).height(containerHeight);
        opus.getViewNamespace().tableScrollbar.update();
    },

    adjustMetadataSelectorMenuPS: function() {
        let containerHeight = $(".op-all-metadata-column").height();
        let menuHeight = $(".op-all-metadata-column .searchMenu").height();

        if (containerHeight > menuHeight) {
            if (!$(".op-all-metadata-column .ps__rail-y").hasClass("hide_ps__rail-y")) {
                $(".op-all-metadata-column .ps__rail-y").addClass("hide_ps__rail-y");
                o_browse.allMetadataScrollbar.settings.suppressScrollY = true;
            }
        } else {
            $(".op-all-metadata-column .ps__rail-y").removeClass("hide_ps__rail-y");
            o_browse.allMetadataScrollbar.settings.suppressScrollY = false;
        }
        o_browse.allMetadataScrollbar.update();
    },

    adjustSelectedMetadataPS: function() {
        let containerHeight = $(".op-selected-metadata-column").height();
        let selectedMetadataHeight = $(".op-selected-metadata-column .ui-sortable").height();

        if (containerHeight > selectedMetadataHeight) {
            if (!$(".op-selected-metadata-column .ps__rail-y").hasClass("hide_ps__rail-y")) {
                $(".op-selected-metadata-column .ps__rail-y").addClass("hide_ps__rail-y");
                o_browse.selectedMetadataScrollbar.settings.suppressScrollY = true;
            }
        } else {
            $(".op-selected-metadata-column .ps__rail-y").removeClass("hide_ps__rail-y");
            o_browse.selectedMetadataScrollbar.settings.suppressScrollY = false;
        }
        o_browse.selectedMetadataScrollbar.update();
    },

    adjustBrowseDialogPS: function() {
        let containerHeight = $("#galleryViewContents .metadata").height();
        let browseDialogHeight = $(".metadata .contents").height();

        if (containerHeight > browseDialogHeight) {
            if (!$("#galleryViewContents .metadata .ps__rail-y").hasClass("hide_ps__rail-y")) {
                $("#galleryViewContents .metadata .ps__rail-y").addClass("hide_ps__rail-y");
                o_browse.modalScrollbar.settings.suppressScrollY = true;
            }
        } else {
            $("#galleryViewContents .metadata .ps__rail-y").removeClass("hide_ps__rail-y");
            o_browse.modalScrollbar.settings.suppressScrollY = false;
        }
        o_browse.modalScrollbar.update();
    },

    cartButtonInfo: function(status) {
        let icon = "fas fa-cart-plus";
        let title = "Add to cart";
        if (status != "in" && status != "remove") {
            icon = "far fa-trash-alt";
            title = "Remove from cart";
        }
        return  {"icon":icon, "title":title};
    },

    updateCartIcon: function(opusId, action) {
        let buttonInfo = o_browse.cartButtonInfo(action);
        let selector = `.op-thumb-overlay [data-id=${opusId}] [data-icon="cart"]`;
        $(selector).html(`<i class="${buttonInfo.icon} fa-xs"></i>`);
        $(selector).prop("title", buttonInfo.title);

        let modalCartSelector = `#galleryViewContents .bottom .select[data-id=${opusId}]`;
        if ($("#galleryView").is(":visible") && $(modalCartSelector).length > 0) {
            $(modalCartSelector).html(`<i class="${buttonInfo.icon} fa-2x"></i>`);
            $(modalCartSelector).prop("title", buttonInfo.title);
        }
    },

    getNextPrevHandles: function(opusId, view) {
        let tab = opus.getViewTab(view);
        let idArray = $(`${tab} .thumbnail-container[data-obs]`).map(function() {
            return $(this).data("id");
        });
        let next = $.inArray(opusId, idArray) + 1;
        next = (next < idArray.length ? idArray[next] : "");

        let prev = $.inArray(opusId, idArray) - 1;
        prev = (prev < 0 ? "" : idArray[prev]);

        return {"next": next, "prev": prev};
    },

    metadataboxHtml: function(opusId, view) {
        o_browse.currentOpusId = opusId;

        // list columns + values
        let html = "<dl>";
        $.each(opus.colLabels, function(index, columnLabel) {
            let value = o_browse.galleryData[opusId][index];
            html += `<dt>${columnLabel}:</dt><dd>${value}</dd>`;
        });
        html += "</dl>";
        $("#galleryViewContents .contents").html(html);

        let nextPrevHandles = o_browse.getNextPrevHandles(opusId, view);
        let status = o_cart.isIn(opusId) ? "" : "in";
        let buttonInfo = o_browse.cartButtonInfo(status);

        // prev/next buttons - put this in galleryView html...
        html = `<div class="col"><a href="#" class="select" data-id="${opusId}" title="${buttonInfo.title}"><i class="${buttonInfo.icon} fa-2x float-left"></i></a></div>`;
        html += `<div class="col text-center">`;
        let opPrevDisabled = (nextPrevHandles.prev == "" ? "op-button-disabled" : "");
        let opNextDisabled = (nextPrevHandles.next == "" ? "op-button-disabled" : "");
        html += `<a href="#" class="prev text-center ${opPrevDisabled}" data-id="${nextPrevHandles.prev}" title="Previous image: ${nextPrevHandles.prev}"><i class="far fa-hand-point-left fa-2x"></i></a>`;
        html += `<a href="#" class="next ${opNextDisabled}" data-id="${nextPrevHandles.next}" title="Next image: ${nextPrevHandles.next}"><i class="far fa-hand-point-right fa-2x"></i></a>`;
        html += `</div>`;

        // mini-menu like the hamburger on the observation/gallery page
        html += `<div class="col"><a href="#" class="menu pr-3 float-right" data-toggle="dropdown" role="button" data-id="${opusId}"><i class="fas fa-bars fa-2x"></i></a></div>`;
        $("#galleryViewContents .bottom").html(html);
    },

    updateGalleryView: function(opusId) {
        // while modal is up, highlight the image/table row shown
        // right here need to add a CSS bit!!
        //////o_browse.toggleGalleryViewHighlight(opusId);
        let namespace = o_browse.getViewInfo().namespace;
        $(namespace).find(".modal-show").removeClass("modal-show");
        $(namespace).find(`[data-id='${opusId}'] div.modal-overlay`).addClass("modal-show");
        $(namespace).find(`tr[data-id='${opusId}']`).addClass("modal-show");
        let imageURL = $(namespace).find(`[data-id='${opusId}'] > a.thumbnail`).data("image");
        o_browse.updateMetaGalleryView(opusId, imageURL);
    },


    updateMetaGalleryView: function(opusId, imageURL) {
        $("#galleryViewContents .left").html(`<a href='${imageURL}' target='_blank'><img src='${imageURL}' title='${opusId}' class='preview'/></a>`);
        o_browse.metadataboxHtml(opusId);
    },


    resetData: function() {
        $(".op-data-table > tbody").empty();  // yes all namespaces
        $(".gallery").empty();
        o_browse.galleryData = {};
        o_cart.cartChange = true;  // forces redraw of cart tab
        o_browse.galleryBegun = false;
        o_hash.updateHash();
    },
};
