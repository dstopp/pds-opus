import settings
from collections import OrderedDict
from django.apps import apps
from django import forms
from metadata.views import *
from search.views import get_param_info_by_slug
from paraminfo.models import *
from tools.app_utils import *

import logging
log = logging.getLogger(__name__)


class MultiStringField(forms.Field):

    def validate(self, value):
        # Use the parent's handling of required fields, etc.
        super(MultiStringField, self).validate(value)

        max_length = 25
        for mult in value:
            if len(mult) > max_length:
                raise forms.ValidationError("string value is too long, limit is " + max_length + ': ' + mult[0:20] + '...')


class MultiFloatField(forms.Field):

    # forms.Field.blank=True

    def validate(self, value):
        # Use the parent's handling of required fields, etc.
        super(MultiFloatField, self).validate(value)

        if not value: return

        if type(value).__name__ != 'str':
            value = [value]

        # for num in value:
        #     try:    float(num)
        #     except: raise forms.ValidationError("value must be a number: " + num[0:20] + '...')


class MultiTimeField(forms.Field):

    # forms.Field.blank=True

    def validate(self, value):
        # Use the parent's handling of required fields, etc.
        super(MultiFloatField(blank=True), self).validate(value)

        for num in value:
            try:    float(num)
            except: raise forms.ValidationError("value must be a number: " + num[0:20] + '...')


class SearchForm(forms.Form):
    """
    >>>> from search.forms import *
    >>>> auto_id = False
    >>>> slug1 = 'planet'
    >>>> slug2 = 'target'
    >>>> form_vals = { slug1:None, slug2:None }
    >>>> SearchForm(form_vals, auto_id=auto_id).as_ul()

    """
    def __init__(self, *args, **kwargs):
        grouped = 'grouping' in kwargs # for the grouping of mult widgets
        grouping = kwargs.pop('grouping', None) # this is how you pass kwargs to the form class, yay!
        super(SearchForm, self).__init__(*args, **kwargs)

        for slug,values in args[0].items():

            param_info = get_param_info_by_slug(slug)
            if not param_info:
                log.error(
            "SearchForm: Could not find param_info entry for slug %s",
            str(slug))
                continue  # todo this should raise end user error

            try:
                form_type = param_info.form_type
            except ParamInfo.DoesNotExist:
                continue    # this is not a query param, probably a qtype, move along

            (form_type, form_type_func,
             form_type_format) = parse_form_type(param_info.form_type)

            if form_type == 'STRING':
                choices =  (('contains','contains'),('begins','begins'),('ends','ends'),('matches','matches'),('excludes','excludes'))
                self.fields[slug] = forms.CharField(
                    widget = forms.TextInput(
                    attrs={'class':'STRING', 'size':'50', 'tabindex':0}),
                    required=False,
                    label = '')
                self.fields['qtype-'+slug] = forms.CharField(
                     required=False,
                     label = '',
                     widget=forms.Select(
                        choices=choices,
                        attrs={'tabindex':0, 'class':'STRING'}
                     ),
                )

            if form_type in settings.RANGE_FIELDS:

                choices =  (('any','any'),('all','all'),('only','only'))
                slug_no_num = strip_numeric_suffix(slug)
                num = get_numeric_suffix(slug)
                if not num:
                    slug = slug + '1'

                label = 'max' if num == '2' else 'min'

                self.fields[slug] = MultiFloatField(
                     required=False,
                     label = label,
                     widget = forms.TextInput(attrs={'class':label + ' RANGE'}),
                )
                self.fields['qtype-'+slug_no_num] = forms.CharField(
                     required=False,
                     label = '',
                     widget=forms.Select(
                        choices=choices,
                        attrs={'tabindex':0, 'class':"RANGE"}
                     ),
                )
                self.fields.keyOrder = [slug_no_num+'1', slug_no_num+'2', 'qtype-'+slug_no_num]  # makes sure min is first! boo ya!

            elif form_type in settings.MULT_FIELDS:
                #self.fields[slug]= MultiStringField(forms.Field)
                try:
                    param_name = ParamInfo.objects.get(slug=slug).param_name()
                except ParamInfo.DoesNotExist:
                    param_name = ParamInfo.objects.get(old_slug=slug).param_name()
                except ParamInfo.DoesNotExist:
                    continue # XXX
                mult_param = get_mult_name(param_name)
                model      = apps.get_model('search',mult_param.title().replace('_',''))

                #grouped mult fields:
                if grouped:
                    choices = [(mult.label, mult.label) for mult in model.objects.filter(grouping=grouping, display='Y').order_by('disp_order')]
                else:
                    choices = [(mult.label, mult.label) for mult in model.objects.filter(display='Y').order_by('disp_order')]

                self.fields[slug] = forms.MultipleChoiceField(
                        # label = ParamInfo.objects.get(slug=slug).label,
                        label = '',
                        choices = choices,
                        widget = forms.CheckboxSelectMultiple(attrs={'class':'multichoice'}),
                        required=False)

        # XXX RF - This is awful. It takes the last form_type from the above loop, but
        # is it possible the loop went more than once??

        # hack to get range fields into the right orde since after Django 1.7 this is deprecated:
        # self.fields.keyOrder = [slug_no_num+'1', slug_no_num+'2', 'qtype-'+slug_no_num]  # makes sure min is first! boo ya!
        if form_type in settings.RANGE_FIELDS:
            my_fields = self.fields
            self.fields = OrderedDict()
            self.fields[slug_no_num+'1'] = my_fields[slug_no_num+'1']
            self.fields[slug_no_num+'2'] = my_fields[slug_no_num+'2']
            if not param_info.special_query:
                self.fields['qtype-'+slug_no_num] = my_fields['qtype-'+slug_no_num]
