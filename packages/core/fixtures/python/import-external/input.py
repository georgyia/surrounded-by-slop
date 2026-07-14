import numpy
from django.http import JsonResponse

def view(request):
    return JsonResponse({"ok": True})
