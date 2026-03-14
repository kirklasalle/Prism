#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** July-26-2025  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\impressioncore_goliath\bridges\__init__.py #python #source_code #web_interface  
**Category:** Source Code  
**Status:** Active
"""






from .ids_bridge import IDSBridge
from .dpa_bridge import DPABridge
from .eds_bridge import EDSBridge
from .ipa_bridge import IPABridge
from .vrgc_bridge import VRGCBridge
from .websearch_bridge import WebSearchBridge

__all__ = [
    "IDSBridge",
    "DPABridge", 
    "EDSBridge",
    "IPABridge",
    "VRGCBridge",
    "WebSearchBridge"
]
