using System;
using System.Text;
using Newtonsoft.Json;

public class Encoder
{
    public string Encode(object value)
    {
        return JsonConvert.SerializeObject(value);
    }
}
