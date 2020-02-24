/* jshint esversion: 6 */
/* jshint bitwise: true, curly: true, freeze: true, futurehostile: true */
/* jshint latedef: true, leanswitch: true, noarg: true, nocomma: true */
/* jshint nonbsp: true, nonew: true */
/* jshint varstmt: true */
/* globals $, PerfectScrollbar */
/* globals o_browse, o_hash, o_menu, o_utils, o_widgets, opus */

/******************************************/
/********* SELECT METADATA DIALOG *********/
/******************************************/
/* jshint varstmt: false */
var o_selectMetadata = {
/* jshint varstmt: true */
    selectMetadataDrawn: false,
    // A flag to determine if the sortable item sorting is happening. This
    // will be used in mutation observer to determine if scrollbar location should
    // be set.
    isSortingHappening: false,

    lastSavedSelected: [],
    lastMetadataMenuRequestNo: 0,

    // metadata selector behaviors
    addBehaviors: function() {
        // global to allow the modal event handlers to communicate
        /* jshint varstmt: false */
        var clickedX = false;
        /* jshint varstmt: true */

        $("#op-select-metadata").on("show.bs.modal", function(e) {
            // this is to make sure modal is back to it original position when open again
            $("#op-select-metadata .modal-dialog").css({top: 0, left: 0});

            o_selectMetadata.adjustHeight();
            o_browse.hideMenu();
            o_selectMetadata.render();

            // Do the fake API call to write in the Apache log files that
            // we invoked the metadata selector so log_analyzer has something to
            // go on
            let fakeUrl = "/opus/__fake/__selectmetadatamodal.json";
            $.getJSON(fakeUrl, function(data) {
            });
        });

        $("#op-select-metadata .close").on("click", function(e) {
            clickedX = true;
        });

        $("#op-select-metadata").on("hide.bs.modal", function(e) {
            // update the data table w/the new columns
            let currentColumns = [];
            $('#op-select-metadata [id*="cchoose__"]').each(function() {
                let slug = this.id.split("cchoose__")[1];
                currentColumns.push(slug);
            });

            if (!o_utils.areObjectsEqual(opus.prefs.cols, currentColumns)) {
                // only pop up the confirm modal if the user clicked the 'X' in the corner
                if (clickedX) {
                    clickedX = false;
                    let targetModal = $(this).find("[data-target]").data("target");
                    $(`#${targetModal}`).modal("show");
                } else {
                    o_selectMetadata.saveChanges();
                    return;
                }
            }
            // remove spinner if nothing is re-draw when we click save changes
            o_browse.hidePageLoaderSpinner();
        });

        $("#op-select-metadata .op-all-metadata-column").on("click", '.submenu li a', function() {
            let slug = $(this).data('slug');
            if (!slug) { return; }

            let chosenSlugSelector = `#cchoose__${slug}`;
            if ($(chosenSlugSelector).length === 0) {
                // this slug was previously unselected, add to cols
                o_selectMetadata.addColumn(slug);
            } else {
                // slug had been checked, remove from the chosen
                o_selectMetadata.removeColumn(slug);
            }
            return false;
        });

        // removes chosen column
        $("#op-select-metadata .op-selected-metadata-column").on("click", "li .op-selected-metadata-unselect", function() {
            let slug = $(this).parent().attr("id").split('__')[1];
            o_selectMetadata.removeColumn(slug);
            return false;
        });

        // buttons
        $("#op-select-metadata").on("click", ".btn", function() {
            switch($(this).attr("type")) {
                case "reset":
                    o_selectMetadata.resetMetadata();
                    break;
                case "submit":
                    break;
                case "cancel":
                    o_selectMetadata.discardChanges();
                    break;
            }
        });

        $("#op-select-metadata").on("click", ".op-download-csv", function(e) {
            let namespace = opus.getViewNamespace();
            namespace.downloadCSV(this);
        });
    },  // /addSelectMetadataBehaviors

    render: function() {
        let tab = opus.getViewTab();
        let downloadTitle = (tab === "#cart" ? "Download a CSV of selected metadata for all observations in the cart" : "Download CSV of selected metadata for ALL observations in current results");
        let buttonTitle = (tab === "#cart" ? "Download CSV (in cart)" : "Download CSV (all results)");

        if (!o_selectMetadata.rendered) {
            let spinnerTimer = setTimeout(function() {
                $("#op-select-metadata .op-menu-spinner.spinner").addClass("op-show-spinner"); }, opus.spinnerDelay);

            // We use getFullHashStr instead of getHash because we want the updated
            // version of widgets= even if the main URL hasn't been updated yet
            let hash = o_hash.getFullHashStr();

            // Figure out which categories are already expanded
            let numberCategories = $("#op-select-metadata .op-submenu-category").length;
            let expandedCategoryLinks = $("#op-select-metadata .op-submenu-category").not(".collapsed");
            let expandedCategories = [];
            $.each(expandedCategoryLinks, function(index, linkObj) {
                expandedCategories.push($(linkObj).data("cat"));
            });
            let expandedCats = "";
            if (numberCategories > 0) {
                /* If there aren't any categories, it means this is the first time we're
                   loading the select metadata menu so let the backend do its default
                   behavior. Otherwise, specify the categories to expand. */
                if (hash !== "") {
                    expandedCats = "&";
                }
                expandedCats += "expanded_cats=" + expandedCategories.join();
            }
            o_selectMetadata.lastMetadataMenuRequestNo++;
            let url = `/opus/__metadata_selector.json?${hash}${expandedCats}&reqno=${o_selectMetadata.lastMetadataMenuRequestNo}`;

            $.getJSON(url, function(data) {
                if (data.reqno < o_selectMetadata.lastMetadataMenuRequestNo) {
                    return;
                }
                $("#op-select-metadata .op-select-metadata-details").html(data.html);
                o_selectMetadata.rendered = true;  // bc this gets saved not redrawn
                $("#op-select-metadata .op-reset-button").hide(); // we are not using this

                // since we are rendering the left side of metadata selector w/the same code that builds the select menu,
                // we need to unhighlight the selected widgets
                o_menu.markMenuItem("#op-select-metadata .op-all-metadata-column a", "unselect");

                // display check next to any currently used columns
                $.each(opus.prefs.cols, function(index, col) {
                    o_menu.markMenuItem(`#op-select-metadata .op-all-metadata-column a[data-slug="${col}"]`);
                });

                // Prevent the same event handlers from being attached to #op-select-metadata
                // for multiple times. This will avoid o_selectMetadata.render() and
                // /opus/__fake/__selectmetadatamodal.json being called for multiple times when
                // the user clicks "Select Metadata" in browse tab.
                $("#op-select-metadata").off("hide.bs.modal");
                $("#op-select-metadata").off("show.bs.modal");

                o_selectMetadata.addBehaviors();

                o_selectMetadata.allMetadataScrollbar = new PerfectScrollbar("#op-select-metadata-contents .op-all-metadata-column", {
                    minScrollbarLength: opus.minimumPSLength
                });
                o_selectMetadata.selectedMetadataScrollbar = new PerfectScrollbar("#op-select-metadata-contents .op-selected-metadata-column", {
                    minScrollbarLength: opus.minimumPSLength
                });

                $("#op-select-metadata a.op-download-csv").attr("title", downloadTitle);
                $("#op-select-metadata a.op-download-csv").text(buttonTitle);

                o_selectMetadata.makeSortable();

                if (opus.prefs.cols.length <= 1) {
                    $("#op-select-metadata .op-selected-metadata-column .op-selected-metadata-unselect").hide();
                }
                o_selectMetadata.lastSavedSelected = $("#op-select-metadata .op-selected-metadata-column > ul").find("li");

                o_selectMetadata.adjustHeight();
                o_selectMetadata.rendered = true;
                o_selectMetadata.hideOrShowPS();
                o_selectMetadata.hideOrShowMenuPS();
                clearTimeout(spinnerTimer);
            });
        }
        $("#op-select-metadata a.op-download-csv").attr("title", downloadTitle);
        $("#op-select-metadata a.op-download-csv").text(buttonTitle);
    },

    makeSortable: function() {
        $("#op-select-metadata .op-selected-metadata-column > ul").sortable({
            items: "li",
            cursor: "grab",
            containment: "parent",
            tolerance: "pointer",
            stop: function(event, ui) {
                o_selectMetadata.metadataDragged(this);
                o_selectMetadata.isSortingHappening = false;
            },
            start: function(event, ui) {
                o_widgets.getMaxScrollTopVal(event.target);
                o_selectMetadata.isSortingHappening = true;
            },
            sort: function(event, ui) {
                o_widgets.preventContinuousDownScrolling(event.target);
            }
        });
    },

    reRender: function() {
        o_selectMetadata.rendered = false;
        o_selectMetadata.render();
    },

    addColumn: function(slug) {
        let menuSelector = `#op-select-metadata .op-all-metadata-column a[data-slug=${slug}]`;
        if ($(menuSelector).length !== 0) {
            o_menu.markMenuItem(menuSelector);

            let label = $(menuSelector).data("qualifiedlabel");
            let info = `<i class="fas fa-info-circle" title="${$(menuSelector).find('*[title]').attr("title")}"></i>`;
            let html = `<li id="cchoose__${slug}" class="ui-sortable-handle"><span class="op-selected-metadata-info">&nbsp;${info}</span>${label}<span class="op-selected-metadata-unselect"><i class="far fa-trash-alt"></span></li>`;
            $("#op-select-metadata .op-selected-metadata-column > ul").append(html);
            if ($("#op-select-metadata .op-selected-metadata-column li").length > 1) {
                $("#op-select-metadata .op-selected-metadata-column .op-selected-metadata-unselect").show();
            }
        }
    },

    removeColumn: function(slug) {
        let menuSelector = `#op-select-metadata .op-all-metadata-column a[data-slug=${slug}]`;
        o_menu.markMenuItem(menuSelector, "unselected");

        $(`#cchoose__${slug}`).fadeOut(200, function() {
            let id = this.id;
            $(`#op-select-metadata .op-selected-metadata-column`).find(`[id="${id}"]`).remove();
            if ($("#op-select-metadata .op-selected-metadata-column li").length <= 1) {
                $("#op-select-metadata .op-selected-metadata-column .op-selected-metadata-unselect").hide();
            }
        });
    },

    updatePrefsCols: function() {
        // update the opus.prefs.cols from the current render of selectedMetadata
        opus.prefs.cols = [];
        $('#op-select-metadata [id*="cchoose__"]').each(function() {
            let slug = this.id.split("cchoose__")[1];
            opus.prefs.cols.push(slug);
        });
    },

    // columns can be reordered wrt each other in 'metadata selector' by dragging them
    metadataDragged: function(element) {
        let cols = $.map($(element).sortable("toArray"), function(item) {
            return item.split("__")[1];
        });
    },

    discardChanges: function() {
        // uncheck all on left; we will check them as we go
        o_menu.markMenuItem("#op-select-metadata .op-all-metadata-column a", "unselect");
        $.each(opus.prefs.cols.slice(), function(index, slug) {
            let menuSelector = `#op-select-metadata .op-all-metadata-column a[data-slug=${slug}]`;
            if ($(menuSelector).length !== 0) {
                o_menu.markMenuItem(menuSelector);
            }
        });

        // remove all from selected column
        $("#op-select-metadata .op-selected-metadata-column li").remove();
        $.each(o_selectMetadata.lastSavedSelected, function(index, selected) {
            $("#op-select-metadata .op-selected-metadata-column > ul").append(selected.outerHTML);
            $(selected).show();
        });
        $("#op-select-metadata").modal('hide');
    },

    resetMetadata: function() {
        // uncheck all on left; we will check them as we go
        o_menu.markMenuItem("#op-select-metadata .op-all-metadata-column a", "unselect");

        // remove all from selected column
        $("#op-select-metadata .op-selected-metadata-column li").remove();

        // add them back and set the check
        $.each(opus.defaultColumns.slice(), function(index, slug) {
            o_selectMetadata.addColumn(slug)
        });
    },

    saveChanges: function() {
        // this needs to be done first so the loadData can load properly
        o_selectMetadata.updatePrefsCols();
        o_selectMetadata.lastSavedSelected = $("#op-select-metadata .op-selected-metadata-column > ul").find("li");
        o_browse.clearObservationData(true); // Leave startobs alone
        o_hash.updateURLFromCurrentHash(); // This makes the changes visible to the user
        o_browse.loadData(opus.prefs.view);
    },

    adjustHeight: function() {
        /**
         * Set the height of the "Select Metadata" dialog based on the browser size.
         */
        $(".op-select-metadata-headers").show(); // Show now so computations are accurate
        $(".op-select-metadata-headers-hr").show();
        let footerHeight = $(".app-footer").outerHeight();
        let mainNavHeight = $("#op-main-nav").outerHeight();
        let modalHeaderHeight = $("#op-select-metadata .modal-header").outerHeight();
        let modalFooterHeight = $("#op-select-metadata .modal-footer").outerHeight();
        let selectMetadataHeadersHeight = $(".op-select-metadata-headers").outerHeight()+30;
        let selectMetadataHeadersHRHeight = $(".op-select-metadata-headers-hr").outerHeight();
        let buttonHeight = $("#op-select-metadata .op-download-csv").outerHeight();
        /* If modalHeaderHeight is zero, the dialog is in the process of being rendered
           and we don't have valid data yet. If we set the height based on the zeros,
           we get an annoying "jump" in the dialog size after it's done rendering.
           So we use a default value that will cover the common case of a dialog wide
           enough to cause excessive header word wrap.
        */
        if (modalHeaderHeight === 0) {
            modalHeaderHeight = 57;
            modalFooterHeight = 68;
            selectMetadataHeadersHeight = 122;
            selectMetadataHeadersHRHeight = 1;
            buttonHeight = 35;
        }
        let totalNonScrollableHeight = (footerHeight + mainNavHeight + modalHeaderHeight +
                                        modalFooterHeight + selectMetadataHeadersHeight +
                                        selectMetadataHeadersHRHeight);
        /* 55 is a rough guess for how much space we want below the dialog, when possible.
           130 is the minimum size required to display four metadata fields.
           Anything less than that makes the dialog useless. In that case we hide the
           header text to give us more room. */
        let height = Math.max($(window).height()-totalNonScrollableHeight-55);
        if (height < 130) {
            $(".op-select-metadata-headers").hide();
            $(".op-select-metadata-headers-hr").hide();
            height += selectMetadataHeadersHeight + selectMetadataHeadersHRHeight;
        }
        $(".op-all-metadata-column").css("height", height);
        $(".op-selected-metadata-column").css("height", height - buttonHeight);
    },

    menuContainerHeight: function() {
        return $("#op-select-metadata .op-all-metadata-column").outerHeight();
    },

    containerHeight: function() {
        return $("#op-select-metadata .op-selected-metadata-column").outerHeight();
    },

    hideOrShowMenuPS: function() {
        let containerHeight = $("#op-select-metadata .op-all-metadata-column").height();
        let menuHeight = $("#op-select-metadata .op-all-metadata-column .op-search-menu").height();
        if (o_selectMetadata.allMetadataScrollbar) {
            if (containerHeight >= menuHeight) {
                if (!$("#op-select-metadata #op-select-metadata .op-all-metadata-column .ps__rail-y").hasClass("hide_ps__rail-y")) {
                    $("#op-select-metadata op-all-metadata-column .ps__rail-y").addClass("hide_ps__rail-y");
                    o_selectMetadata.allMetadataScrollbar.settings.suppressScrollY = true;
                }
            } else {
                $("#op-select-metadata .op-all-metadata-column .ps__rail-y").removeClass("hide_ps__rail-y");
                o_selectMetadata.allMetadataScrollbar.settings.suppressScrollY = false;
            }
            o_selectMetadata.allMetadataScrollbar.update();
        }
    },

    hideOrShowPS: function() {
        let containerHeight = $("#op-select-metadata .op-selected-metadata-column").height();
        let selectedMetadataHeight = $("#op-select-metadata .op-selected-metadata-column .ui-sortable").height();

        if (o_selectMetadata.selectedMetadataScrollbar) {
            if (containerHeight >= selectedMetadataHeight) {
                if (!$("#op-select-metadata .op-selected-metadata-column .ps__rail-y").hasClass("hide_ps__rail-y")) {
                    $("#op-select-metadata .op-selected-metadata-column .ps__rail-y").addClass("hide_ps__rail-y");
                    o_selectMetadata.selectedMetadataScrollbar.settings.suppressScrollY = true;
                }
            } else {
                $("#op-select-metadata .op-selected-metadata-column .ps__rail-y").removeClass("hide_ps__rail-y");
                o_selectMetadata.selectedMetadataScrollbar.settings.suppressScrollY = false;
            }
            o_selectMetadata.selectedMetadataScrollbar.update();
        }
    },
};
