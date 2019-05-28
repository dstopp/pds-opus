/* jshint esversion: 6 */
/* jshint bitwise: true, curly: true, freeze: true, futurehostile: true */
/* jshint latedef: true, leanswitch: true, noarg: true, nocomma: true */
/* jshint nonbsp: true, nonew: true */
/* jshint varstmt: true */
/* jshint multistr: true */
/* globals $, _, PerfectScrollbar */
/* globals o_hash, opus */

/* jshint varstmt: false */
var o_detail = {
/* jshint varstmt: true */

    activateDetailTab: function(opusId) {

        $("#detail").on("click", ".op-download-csv", function() {
            let colStr = opus.prefs.cols.join(',');
            $(this).attr("href", `/opus/__api/metadata_v2/${opusId}.csv?cols=${colStr}`);
        });

        $("#detail").on("click", "a[data-action]", function() {
            switch($(this).data("action")) {
                case "downloadData":
                    $(this).attr("href", `/opus/__api/download/${opusId}.zip?cols=${opus.prefs.cols.join()}`);
                    break;
                case "downloadURL":
                    $(this).attr("href", `/opus/__api/download/${opusId}.zip?urlonly=1&cols=${opus.prefs.cols.join()}`);
                    break;
            }
            //return false;
        });

        opus.prefs.detail = opusId;
        let detailSelector = "#detail .panel";

        if (!opusId) {
            // helpful
            let html = ' \
                <div style = "margin:20px"><h2>No Observation Selected</h2>   \
                <p>To view details about an observation, click on the Browse Results tab<br>  \
                at the top of the page. Click on a thumbnail and then "View Detail".</p>   \
                </div>';

            $(detailSelector).html(html).fadeIn();

            return;
        }

        $(detailSelector).html(opus.spinner);

        $(detailSelector).load("/opus/__initdetail/" + opusId + ".html",
            function(response, status, xhr) {
                if (status == 'error') {
                    let html = ' \
                        <div style = "margin:20px"><h2>Bad OPUS ID</h2>   \
                        <p>The specified OPUS_ID (or old RING_OBS_ID) was not found in the database.</p>   \
                        </div>';

                    $(detailSelector).html(html).fadeIn();
                    return;
                }
                let arrOfDeferred = [];
                // get the column metadata, this part is fast
                let urlMetadataColumn = "/opus/__api/metadata_v2/" + opusId + ".html?" + o_hash.getHash();
                $("#cols_metadata_"+opusId)
                    .load(urlMetadataColumn, function() {
                        $(this).hide().fadeIn("fast");
                    }
                );

                // get categories and then send for data for each category separately:
                let urlCategories = "/opus/__api/categories/" + opusId + ".json?" + o_hash.getHash();
                $.getJSON(urlCategories, function(categories) {
                    $.each(categories, function(idx, val) {
                        arrOfDeferred.push($.Deferred());
                    });

                    for (let index in categories) {
                        let tableName = categories[index].table_name;
                        let label = categories[index].label;
                        let html = '<h3>' + label + '</h3><div class = "detail_' + tableName + '">Loading <span class = "spinner">&nbsp;</span></div>';
                        $("#all_metadata_" + opusId).append(html);

                        // now send for data
                        let urlMetadata ="/opus/__api/metadata_v2/" + opusId + ".html?cats=" + tableName;
                        $("#all_metadata_" + opusId + ' .detail_' + tableName)
                            .load(urlMetadata, function() {
                                $(this).hide().slideDown("fast");
                                arrOfDeferred[index].resolve();
                            }
                        );

                    } // end json loop

                    // Wait until all .load are done, and then update perfectScrollbar
                    $.when.apply(null, arrOfDeferred).then(function() {
                        let initDetailPageScrollbar = _.debounce(o_detail.initAndUpdatePerfectScrollbar, 200);
                        initDetailPageScrollbar();
                    });
                });
            } // /detail.load
        );
    }, // / activateDetailTab

    // Note: PS is init every time when html is rendered. The previous PS will be garbage collected and there isn't a memory leak here even though we're calling new (to init ps) over and over.
    initAndUpdatePerfectScrollbar: function() {
        o_detail.detailPageScrollbar = new PerfectScrollbar(".detail-metadata", {
            minScrollbarLength: opus.minimumPSLength
        });
        o_detail.detailPageScrollbar.update();
    },

    adjustDetailHeight: function() {
        let containerHeight = $(window).height()-100;
        if (o_detail.detailPageScrollbar) {
            $(".detail-metadata").height(containerHeight);
            o_detail.detailPageScrollbar.update();
        }
    },

};
